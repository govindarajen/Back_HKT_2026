# =============================================================================
# dags/dag_pipeline.py
# =============================================================================
# DAG Airflow qui orchestre le pipeline de traitement des documents.
#
# Ce DAG se déclenche automatiquement toutes les minutes et vérifie si
# des documents sont en attente de traitement dans MongoDB (statut "queued").
#
# Pipeline :
#   1. ingestion  → vérifie les documents en attente dans raw MongoDB
#   2. ocr        → confirme que l'OCR a bien été fait (clean MongoDB)
#   3. extraction → confirme que l'extraction est faite (curated MongoDB)
#   4. validation → confirme que les anomalies ont été vérifiées
#
# Note : Le vrai traitement est fait par le backend Node.js.
#        Ce DAG surveille et orchestre le flux, et peut relancer
#        les étapes en cas d'échec.
# =============================================================================
 
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta
from pymongo import MongoClient
import os
import logging
 
# ── Connexion MongoDB ─────────────────────────────────────────────────────────
# MONGO_URI est passé via les variables d'environnement du docker-compose
MONGO_URI = os.environ.get("MONGO_URI", "")
 
def get_db():
    """Retourne la connexion à la base MongoDB."""
    client = MongoClient(MONGO_URI)
    return client["hackathon_2026"]  # remplace "test" par le nom de ta base si différent
 
 
# =============================================================================
# TÂCHE 1 — INGESTION
# Vérifie les documents bruts en attente dans la raw zone
# =============================================================================
def tache_ingestion(**context):
    """
    Récupère tous les RawDocuments avec statut 'queued'.
    Passe leurs IDs à la tâche suivante via XCom.
    XCom = système de communication entre tâches dans Airflow.
    """
    db = get_db()
    raw_collection = db["rawdocuments"]
 
    # Cherche tous les documents en attente
    docs_en_attente = list(raw_collection.find(
        {"status": "queued"},
        {"_id": 1, "filename": 1}   # on ne récupère que l'ID et le nom
    ))
 
    if not docs_en_attente:
        logging.info("[Ingestion] Aucun document en attente.")
        return []
 
    # Convertit les ObjectId en string pour la sérialisation XCom
    ids = [str(doc["_id"]) for doc in docs_en_attente]
    noms = [doc.get("filename", "inconnu") for doc in docs_en_attente]
 
    logging.info(f"[Ingestion] {len(ids)} document(s) en attente : {noms}")
 
    # Retourne les IDs — Airflow les stocke automatiquement dans XCom
    return ids
 
 
# =============================================================================
# TÂCHE 2 — OCR
# Vérifie que chaque document raw a bien un CleanDocument associé
# =============================================================================
def tache_ocr(**context):
    """
    Pour chaque rawId récupéré en tâche 1,
    vérifie qu'un CleanDocument (texte OCR) existe en base.
    Si non → log une erreur (le backend devrait l'avoir créé).
    """
    # xcom_pull récupère le résultat retourné par la tâche 'ingestion'
    raw_ids = context["ti"].xcom_pull(task_ids="ingestion")
 
    if not raw_ids:
        logging.info("[OCR] Aucun document à vérifier.")
        return []
 
    db = get_db()
    clean_collection = db["cleandocuments"]
 
    ids_ok = []
    ids_ko = []
 
    for raw_id in raw_ids:
        clean_doc = clean_collection.find_one({"rawId": raw_id})
        if clean_doc and clean_doc.get("ocrText"):
            ids_ok.append(raw_id)
            logging.info(f"[OCR] {raw_id} → texte OCR présent ({len(clean_doc['ocrText'])} chars)")
        else:
            ids_ko.append(raw_id)
            logging.warning(f"[OCR] {raw_id} → pas de texte OCR trouvé")
 
    logging.info(f"[OCR] Résultat : {len(ids_ok)} OK / {len(ids_ko)} manquants")
    return ids_ok   # on passe uniquement les IDs OK à la tâche suivante
 
 
# =============================================================================
# TÂCHE 3 — EXTRACTION
# Vérifie que chaque document a bien un CuratedDocument associé
# =============================================================================
def tache_extraction(**context):
    """
    Pour chaque rawId avec OCR confirmé,
    vérifie qu'un CuratedDocument (données extraites) existe en base.
    """
    ids_ocr_ok = context["ti"].xcom_pull(task_ids="ocr")
 
    if not ids_ocr_ok:
        logging.info("[Extraction] Aucun document à vérifier.")
        return []
 
    db = get_db()
    curated_collection = db["curateddocuments"]
 
    ids_ok = []
    ids_ko = []
 
    for raw_id in ids_ocr_ok:
        curated_doc = curated_collection.find_one({"rawId": raw_id})
        if curated_doc:
            ids_ok.append(raw_id)
            logging.info(f"[Extraction] {raw_id} → type détecté : {curated_doc.get('detectedType', 'inconnu')}")
        else:
            ids_ko.append(raw_id)
            logging.warning(f"[Extraction] {raw_id} → pas de données extraites")
 
    logging.info(f"[Extraction] Résultat : {len(ids_ok)} OK / {len(ids_ko)} manquants")
    return ids_ok
 
 
# =============================================================================
# TÂCHE 4 — VALIDATION
# Vérifie les anomalies et met à jour le statut final des documents
# =============================================================================
def tache_validation(**context):
    """
    Pour chaque document extrait avec succès :
    - vérifie si des anomalies ont été détectées
    - met à jour le statut du RawDocument à 'processed'
    - log un résumé des anomalies trouvées
    """
    ids_extraction_ok = context["ti"].xcom_pull(task_ids="extraction")
 
    if not ids_extraction_ok:
        logging.info("[Validation] Aucun document à valider.")
        return
 
    db = get_db()
    raw_collection     = db["rawdocuments"]
    curated_collection = db["curateddocuments"]
 
    total_anomalies = 0
 
    for raw_id in ids_extraction_ok:
        curated_doc = curated_collection.find_one({"rawId": raw_id})
 
        if not curated_doc:
            continue
 
        anomalies = curated_doc.get("anomalies", [])
        statut    = curated_doc.get("validationStatus", "inconnu")
 
        if anomalies:
            total_anomalies += len(anomalies)
            logging.warning(
                f"[Validation] {raw_id} → {len(anomalies)} anomalie(s) : "
                f"{[a.get('type') for a in anomalies]}"
            )
        else:
            logging.info(f"[Validation] {raw_id} → aucune anomalie (statut: {statut})")
 
        # Met à jour le statut du document raw à 'processed'
        raw_collection.update_one(
            {"_id": raw_id},
            {"$set": {"status": "processed"}}
        )
 
    logging.info(
        f"[Validation] Pipeline terminé — "
        f"{len(ids_extraction_ok)} document(s) traité(s), "
        f"{total_anomalies} anomalie(s) au total."
    )
 
 
# =============================================================================
# DÉFINITION DU DAG
# =============================================================================
with DAG(
    dag_id="pipeline_documents",        # nom affiché dans l'interface Airflow
    description="Pipeline OCR et extraction de documents administratifs",
    start_date=datetime(2026, 1, 1),
    schedule="* * * * *",               # toutes les minutes (cron expression)
    catchup=False,                      # ne retraite pas les exécutions passées
    default_args={
        "retries": 1,                   # 1 retry automatique en cas d'échec
        "retry_delay": timedelta(minutes=2),
    },
    tags=["hackathon", "documents", "ocr"],
) as dag:
 
    # Définition des tâches
    ingestion  = PythonOperator(task_id="ingestion",  python_callable=tache_ingestion)
    ocr        = PythonOperator(task_id="ocr",        python_callable=tache_ocr)
    extraction = PythonOperator(task_id="extraction", python_callable=tache_extraction)
    validation = PythonOperator(task_id="validation", python_callable=tache_validation)
 
    # Ordre d'exécution : chaque >> signifie "puis"
    ingestion >> ocr >> extraction >> validation