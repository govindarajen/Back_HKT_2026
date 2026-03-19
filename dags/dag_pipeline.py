# =============================================================================
# dags/dag_pipeline.py
# =============================================================================
# DAG Airflow qui exécute le pipeline complet de traitement d'un document.
#
# Déclenché par le backend Node.js via l'API REST Airflow à chaque upload.
# Le backend passe le rawId du document en paramètre (conf).
#
# Pipeline :
#   1. ingestion  → récupère le fichier depuis MongoDB GridFS
#   2. ocr        → lance test_fct.py → sauvegarde CleanDocument
#   3. extraction → lance extract_text.py → mapping → sauvegarde CuratedDocument
#   4. validation → lance check_anomalie.py → met à jour les anomalies
# =============================================================================
 
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta
from pymongo import MongoClient
from bson import ObjectId
import os
import subprocess
import tempfile
import json
import logging
 
# ── Connexion MongoDB ─────────────────────────────────────────────────────────
MONGO_URI = os.environ.get("MONGO_URI", "")
 
def get_db():
    client = MongoClient(MONGO_URI)
    db_name = MONGO_URI.split("/")[-1].split("?")[0] or "test"
    return client[db_name]
 
SCRIPTS_DIR = "/opt/airflow/scripts"
 
 
# =============================================================================
# TÂCHE 1 — INGESTION
# Récupère le fichier depuis GridFS et le sauvegarde en fichier temporaire
# =============================================================================
def tache_ingestion(**context):
    raw_id = context["dag_run"].conf.get("raw_id")
    if not raw_id:
        raise ValueError("[Ingestion] raw_id manquant dans conf !")
 
    logging.info(f"[Ingestion] Traitement du document rawId: {raw_id}")
 
    db = get_db()
    raw_collection = db["rawdocuments"]
 
    raw_doc = raw_collection.find_one({"_id": ObjectId(raw_id)})
    if not raw_doc:
        raise ValueError(f"[Ingestion] RawDocument introuvable: {raw_id}")
 
    filename = raw_doc.get("filename", "document")
    file_url = raw_doc.get("fileUrl")
    mimetype = raw_doc.get("metadata", {}).get("mimetype", "application/pdf")
 
    # Télécharge le fichier depuis GridFS
    import gridfs
    client = MongoClient(MONGO_URI)
    db_name = MONGO_URI.split("/")[-1].split("?")[0] or "test"
    fs = gridfs.GridFS(client[db_name], collection="rawFiles")
    file_data = fs.get(ObjectId(file_url)).read()
 
    # Sauvegarde dans un fichier temporaire
    suffix = ".pdf" if "pdf" in mimetype else os.path.splitext(filename)[1] or ".pdf"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(file_data)
    tmp.close()
 
    logging.info(f"[Ingestion] Fichier sauvegardé: {tmp.name} ({len(file_data)} bytes)")
 
    raw_collection.update_one(
        {"_id": ObjectId(raw_id)},
        {"$set": {"status": "processing"}}
    )
 
    return {"tmp_path": tmp.name, "raw_id": raw_id, "filename": filename}
 
 
# =============================================================================
# TÂCHE 2 — OCR
# Lance test_fct.py → sauvegarde le CleanDocument
# =============================================================================
def tache_ocr(**context):
    ingestion_result = context["ti"].xcom_pull(task_ids="ingestion")
    tmp_path = ingestion_result["tmp_path"]
    raw_id   = ingestion_result["raw_id"]
 
    logging.info(f"[OCR] Lancement OCR sur: {tmp_path}")
 
    output_path = tmp_path + "_ocr.txt"
 
    result = subprocess.run(
        ["python3", os.path.join(SCRIPTS_DIR, "test_fct.py"), tmp_path, "--save", output_path],
        capture_output=True,
        text=True
    )
 
    if result.returncode != 0:
        raise RuntimeError(f"[OCR] Échec: {result.stderr}")
 
    with open(output_path, "r", encoding="utf-8") as f:
        ocr_text = f.read().strip()
 
    # Nettoyage fichiers temporaires
    os.unlink(tmp_path)
    os.unlink(output_path)
 
    logging.info(f"[OCR] Texte extrait: {len(ocr_text)} caractères")
 
    # Sauvegarde le CleanDocument
    db = get_db()
    clean_result = db["cleandocuments"].insert_one({
        "rawId":          ObjectId(raw_id),
        "ocrText":        ocr_text,
        "jsonExtracted":  {},
        "extractionDate": datetime.now(),
        "status":         "processed",
    })
 
    logging.info(f"[OCR] CleanDocument créé: {clean_result.inserted_id}")
 
    return {
        "ocr_text": ocr_text,
        "raw_id":   raw_id,
        "clean_id": str(clean_result.inserted_id)
    }
 
 
# =============================================================================
# TÂCHE 3 — EXTRACTION
# Lance extract_text.py → mapping du JSON → sauvegarde le CuratedDocument
# =============================================================================
def tache_extraction(**context):
    ocr_result = context["ti"].xcom_pull(task_ids="ocr")
    ocr_text   = ocr_result["ocr_text"]
    raw_id     = ocr_result["raw_id"]
    clean_id   = ocr_result["clean_id"]
 
    logging.info(f"[Extraction] Lancement sur {len(ocr_text)} chars")
 
    # Lance extract_text.py — reçoit le texte OCR via stdin, retourne du JSON
    result = subprocess.run(
        ["python3", os.path.join(SCRIPTS_DIR, "extract_text.py")],
        input=ocr_text,
        capture_output=True,
        text=True,
        encoding="utf-8"
    )
 
    if result.returncode != 0:
        raise RuntimeError(f"[Extraction] Échec: {result.stderr}")
 
    parsed = json.loads(result.stdout)
    logging.info(f"[Extraction] Type: {parsed.get('detectedType')} | SIRET: {parsed.get('siret')}")
 
    # ── Mapping : format extract_text.py → format CuratedDocument ────────
    # Le mapping est nécessaire car extract_text.py retourne des listes de dicts
    # (ex: dates = [{"label": "Date d'emission", "date": "17/11/2025"}])
    # alors que CuratedDocument attend des champs séparés (dateEmission, dateEcheance...)
 
    db = get_db()
    raw_doc       = db["rawdocuments"].find_one({"_id": ObjectId(raw_id)})
    enterprise_id = raw_doc.get("enterpriseId") if raw_doc else None
 
    # SIRET : extract_siret() retourne une liste → on prend le premier
    siret_value = None
    if parsed.get("siret"):
        siret_value = parsed["siret"][0].replace(" ", "")
 
    # Montants : extract_montants() retourne [{"label": ..., "montant": ...}]
    # → on mappe sur montantHT, montantTTC, tva selon le label
    montant_ht  = None
    montant_ttc = None
    tva_val     = None
    for m in parsed.get("montants", []):
        label = (m.get("label") or "").lower()
        val   = m.get("montant")
        if not val:
            continue
        try:
            val_float = float(
                str(val).replace(",", ".").replace(" ", "")
                        .replace("€", "").replace("EUR", "")
            )
        except ValueError:
            continue
        if "ht" in label:
            montant_ht = val_float
        elif "ttc" in label:
            montant_ttc = val_float
        elif "tva" in label:
            tva_val = val_float
 
    # Dates : extract_dates() retourne [{"label": ..., "date": "DD/MM/YYYY"}]
    # → on mappe sur dateEmission, dateEcheance, dateExpiration selon le label
    def parse_date(s):
        if not s:
            return None
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        return None
 
    date_emission   = None
    date_echeance   = None
    date_expiration = None
    for d in parsed.get("dates", []):
        label = (d.get("label") or "").lower()
        if "emission" in label and not date_emission:
            date_emission = parse_date(d.get("date"))
        elif ("echeance" in label or "valable" in label) and not date_echeance:
            date_echeance = parse_date(d.get("date"))
        elif "expiration" in label and not date_expiration:
            date_expiration = parse_date(d.get("date"))
 
    # ── Sauvegarde le CuratedDocument ────────────────────────────────────
    curated_result = db["curateddocuments"].insert_one({
        "rawId":          ObjectId(raw_id),
        "cleanId":        ObjectId(clean_id),
        "enterpriseId":   enterprise_id,
        "detectedType":   parsed.get("detectedType", "inconnu"),
        "numeroDocument": parsed.get("numeroDocument"),
        "siret":          siret_value,
        "montantHT":      montant_ht,
        "montantTTC":     montant_ttc,
        "tva":            tva_val,
        "dateEmission":   date_emission,
        "dateEcheance":   date_echeance,
        "dateExpiration": date_expiration,
        "modePaiement":   parsed.get("mode_paiement"),
        "address":        parsed.get("address"),
        "status":         "needs_validation",
        "anomalies":      [],
    })
 
    curated_id = str(curated_result.inserted_id)
    logging.info(f"[Extraction] CuratedDocument créé: {curated_id}")
 
    return {
        "curated_id": curated_id,
        "raw_id":     raw_id,
        "clean_id":   clean_id,
        "siret":      siret_value,
    }
 
 
# =============================================================================
# TÂCHE 4 — VALIDATION
# Lance check_anomalie.py → met à jour les anomalies sur le CuratedDocument
# =============================================================================
def tache_validation(**context):
    extraction_result = context["ti"].xcom_pull(task_ids="extraction")
    curated_id = extraction_result["curated_id"]
    raw_id     = extraction_result["raw_id"]
    clean_id   = extraction_result["clean_id"]
    siret      = extraction_result["siret"]
 
    db = get_db()
    curated_collection = db["curateddocuments"]
 
    anomalies = []
 
    if siret:
        # Récupère tous les documents du même fournisseur (même SIRET)
        related_docs = list(curated_collection.find({"siret": siret}))
 
        # Sérialise pour check_anomalie.py (les dates doivent être des strings)
        docs_for_python = [
            {
                "_id":            str(d["_id"]),
                "detectedType":   d.get("detectedType"),
                "siret":          d.get("siret"),
                "numeroDocument": d.get("numeroDocument"),
                "montantTTC":     d.get("montantTTC"),
                "montantHT":      d.get("montantHT"),
                "dateEmission":   d["dateEmission"].isoformat() if d.get("dateEmission") else None,
                "dateEcheance":   d["dateEcheance"].isoformat() if d.get("dateEcheance") else None,
                "dateExpiration": d["dateExpiration"].isoformat() if d.get("dateExpiration") else None,
            }
            for d in related_docs
        ]
 
        anomaly_result = subprocess.run(
            ["python3", os.path.join(SCRIPTS_DIR, "check_anomalie.py"), "--stdin"],
            input=json.dumps(docs_for_python),
            capture_output=True,
            text=True,
            encoding="utf-8"
        )
 
        if anomaly_result.returncode == 0:
            try:
                result_json = json.loads(anomaly_result.stdout)
                anomalies = result_json if isinstance(result_json, list) else result_json.get("anomalies", [])
            except json.JSONDecodeError:
                logging.warning("[Validation] Impossible de parser les anomalies")
        else:
            logging.error(f"[Validation] check_anomalie.py erreur: {anomaly_result.stderr}")
 
    # Met à jour le CuratedDocument avec les anomalies
    validation_status = "invalid" if anomalies else "valid"
    curated_collection.update_one(
        {"_id": ObjectId(curated_id)},
        {"$set": {
            "anomalies":         anomalies,
            "validationStatus":  validation_status,
            "validationMessage": f"{len(anomalies)} anomalie(s) détectée(s)" if anomalies else "Aucune anomalie détectée",
            "validatedAt":       datetime.now(),
        }}
    )
 
    # Met à jour les statuts raw et clean
    db["rawdocuments"].update_one(
        {"_id": ObjectId(raw_id)},
        {"$set": {"status": "processed"}}
    )
    db["cleandocuments"].update_one(
        {"_id": ObjectId(clean_id)},
        {"$set": {"status": "processed"}}
    )
 
    logging.info(f"[Validation] {len(anomalies)} anomalie(s) — statut: {validation_status}")
    logging.info(f"[Validation] Pipeline terminé pour rawId: {raw_id}")
 
 
# =============================================================================
# DÉFINITION DU DAG
# =============================================================================
with DAG(
    dag_id="pipeline_documents",
    description="Pipeline OCR et extraction de documents administratifs",
    start_date=datetime(2026, 1, 1),
    schedule=None,       # déclenché par le backend via l'API REST Airflow
    catchup=False,
    default_args={
        "retries": 1,
        "retry_delay": timedelta(minutes=2),
    },
    tags=["hackathon", "documents", "ocr"],
) as dag:
 
    ingestion  = PythonOperator(task_id="ingestion",  python_callable=tache_ingestion)
    ocr        = PythonOperator(task_id="ocr",        python_callable=tache_ocr)
    extraction = PythonOperator(task_id="extraction", python_callable=tache_extraction)
    validation = PythonOperator(task_id="validation", python_callable=tache_validation)
 
    ingestion >> ocr >> extraction >> validation
 