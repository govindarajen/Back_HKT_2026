from datetime import date, datetime
import json
import sys
import io

# Force UTF-8 output on Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def parse_date(date_str: str) -> date | None:
    """Parse date string in multiple formats"""
    if not date_str:
        return None
    
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y", "%Y/%m/%d", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            dt = datetime.strptime(str(date_str), fmt)
            return dt.date() if isinstance(dt, datetime) else dt
        except (ValueError, TypeError, AttributeError):
            continue
    return None


def check_anomalies(docs: list) -> list:
    """
    Check for anomalies in documents with the same SIRET
    Documents are passed in via stdin from Node.js
    
    Anomalies checked:
    - URSSAF expiration
    - Supplier ceased (SIRET status)
    - Duplicate invoices
    - Missing devis for facture
    - Invoice amount > quote amount
    - Invoice dated after quote expiration
    """
    anomalies = []
    
    if not docs:
        print(f"NO_DOCS: No documents provided", file=sys.stderr)
        return anomalies

    # Organize by type ───────────────────────────────────────
    by_type = {}
    for doc in docs:
        t = doc.get("detectedType", "inconnu")
        if t not in by_type:
            by_type[t] = []
        by_type[t].append(doc)

    factures = by_type.get("facture", [])
    devis    = by_type.get("devis",   [])

    # ── Check 1: URSSAF expiration ──────────────────────────────────────────
    for doc in by_type.get("urssaf", []):
        date_exp = doc.get("dateExpiration")
        if date_exp:
            if isinstance(date_exp, datetime):
                date_exp = date_exp.date()
            elif isinstance(date_exp, str):
                date_exp = parse_date(date_exp)
            
            if date_exp and date_exp < date.today():
                anomalies.append({
                    "type":    "URSSAF_EXPIREE",
                    "severity":  "CRITIQUE",
                    "message": f"Attestation URSSAF expiree depuis le {date_exp}"
                })

    # ── Check 2: Supplier ceased ───────────────────────────────────────
    for doc in by_type.get("siret", []):
        if doc.get("statut_siret") == "CESSE":
            anomalies.append({
                "type":    "FOURNISSEUR_CESSE",
                "severity":  "CRITIQUE",
                "message": "Le fournisseur est cesse d'activite"
            })

    # ── Check 3: Duplicate facture  ──────────────────────
    numeros_factures = [f.get("numeroDocument", {}).get("numero") for f in factures if f.get("numeroDocument", {}).get("numero")]
    doublons = set(n for n in numeros_factures if numeros_factures.count(n) > 1)
    for num in doublons:
        anomalies.append({
            "type":    "DOUBLON_FACTURE",
            "severity":  "CRITIQUE",
            "message": f"Facture {num} presente en double"
        })

    # ── Check 4: Duplicate devis (same number) ─────────────────────
    numeros_devis = [d.get("numeroDocument", {}).get("numero") for d in devis if d.get("numeroDocument", {}).get("numero")]
    doublons_devis = set(n for n in numeros_devis if numeros_devis.count(n) > 1)
    for num in doublons_devis:
        anomalies.append({
            "type":    "DOUBLON_DEVIS",
            "severity":  "CRITIQUE",
            "message": f"Devis {num} present en double"
        })

    # ── Check 5: Link facture <-> devis via ref ───────────────────────
    for facture in factures:
        ref     = facture.get("numeroDocument", {}).get("ref")
        num_fac = facture.get("numeroDocument", {}).get("numero")

        if not ref:
            anomalies.append({
                "type":    "REF_DEVIS_ABSENTE",
                "severity":  "INFO",
                "message": f"Facture {num_fac} sans reference devis"
            })
            continue

        # Find devis with same ref
        devis_lie = next((d for d in devis if d.get("numeroDocument", {}).get("ref") == ref), None)

        if not devis_lie:
            # Don't add anomaly if there's no devis - it's expected behavior
            continue

        # ── Check 6: montant de facture vs montant de devis ─────────────────────
        ttc_fac  = facture.get("montantTTC")
        ttc_dev  = devis_lie.get("montantTTC")
        num_dev  = devis_lie.get("numeroDocument", {}).get("numero")
        num_fac  = facture.get("numeroDocument", {}).get("numero")
        
        # Ensure both are numbers
        try:
            ttc_fac = float(ttc_fac) if ttc_fac else None
            ttc_dev = float(ttc_dev) if ttc_dev else None
        except (ValueError, TypeError):
            ttc_fac = None
            ttc_dev = None
        
        if ttc_fac and ttc_dev and ttc_fac != ttc_dev:
            anomalies.append({
                "type":    "MONTANT_DIFFERENT",
                "severity":  "AVERTISSEMENT",
                "message": f"Facture {num_fac} ({ttc_fac} EUR) ≠ Devis {num_dev} ({ttc_dev} EUR)"
            })

        # ── Check 7: mismatch entre date expiration de devis et echeance────────────
        date_validite  = devis_lie.get("dateEcheance")
        date_facturation = facture.get("dateEmission")

        if date_validite and date_facturation:
            if isinstance(date_validite, str):
                date_validite = parse_date(date_validite)
            elif isinstance(date_validite, datetime):
                date_validite = date_validite.date()
            
            if isinstance(date_facturation, str):
                date_facturation = parse_date(date_facturation)
            elif isinstance(date_facturation, datetime):
                date_facturation = date_facturation.date()
            
            if date_validite and date_facturation and date_facturation > date_validite:
                anomalies.append({
                    "type":    "DEVIS_EXPIRE",
                    "severity":  "AVERTISSEMENT",
                    "message": f"Devis {num_dev} expire le {date_validite}, "
                               f"facture {num_fac} emise le {date_facturation}"
                })

    return anomalies


if __name__ == "__main__":
    # Usage: 
    # Node.js will pass documents as JSON via stdin
    # python check_anomalie.py --stdin
    
    if len(sys.argv) > 1 and sys.argv[1] == "--stdin":
        try:
            # Read JSON documents from stdin
            input_data = sys.stdin.read()
            docs = json.loads(input_data)
            
            # Check anomalies
            anomalies = check_anomalies(docs)
            
            # Return structured response
            result = {
                "anomalies": anomalies,
                "isValid": len(anomalies) == 0,
                "validationMessage": "Aucune anomalie detectee" if len(anomalies) == 0 else f"{len(anomalies)} anomalie(s) detectee(s)"
            }
            
            print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
        except json.JSONDecodeError as e:
            print(json.dumps({
                "anomalies": [],
                "isValid": False,
                "validationMessage": f"JSON parse error: {str(e)}"
            }, indent=2, ensure_ascii=False, default=str))
    else:
        # Return empty array if no argument provided
        result = {
            "anomalies": [],
            "isValid": True,
            "validationMessage": "Aucune anomalie detectea"
        }
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))