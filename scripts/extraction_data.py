import sys #gestion des erreurs systèmes
import os #manipulation de fichiers/dossiers
import argparse #
from pathlib import Path #gestion des fichiers , plus moderne que os.path
import re #utilisation des regex 

#outils du ocr
import pytesseract
from PIL import Image
from pdf2image import convert_from_path

def extract_siret(text: str) -> dict:
    """
    Extrait SIRET (14 chiffres) et SIREN (9 chiffres).
 
    Gère les formats rencontrés sur factures françaises :
      - 999 999 999 99999   (espaces)
      - 999-999-999-99999   (tirets)
      - 99999999999999      (collé)
      - 1234567-8           (SIREN avec tiret = format registre)
    """
    # Colle les chiffres séparés par espaces ou tirets (3 passes pour "123 456 789")
    text_norm = text
    for _ in range(4):
        text_norm = re.sub(r'(\d)[\s\-](\d)', r'\1\2', text_norm)
 
    # SIRET : 14 chiffres
    siret_raw = re.findall(r'\b(\d{14})\b', text_norm) #\b:début de mot / \d{14}:exactement 14 chiffres / \b:fin de mot
 
    return list(dict.fromkeys(siret_raw))
 

def extract_montants(text: str) -> list[dict]:
    """
    Extrait les montants avec leur label contextuel si présent.
    Gère : 1 350,00 € / 1350.00 € / EUR 1 350,00 / 1 350 €
    Retourne une liste de dicts {"label": ..., "montant": ...}
    """
    amount_pat = r'\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d{1,2})?'
    devise_pat = r'(?:\s*€|\s*EUR)'
    full_pat   = rf'({amount_pat}){devise_pat}'
 
    label_keywords = [
        r'total\s+ttc', r'total\s+ht', r'total\s+tva',
        r'tva', r'montant\s+ht', r'montant\s+ttc',
        r'sous[\s\-]total', r'remise', r'acompte',
        r'net\s+à\s+payer', r'solde', r'prix\s+unitaire',
    ]
    label_pat = '|'.join(label_keywords)
 
    results = []
    for line in text.splitlines():
        line_norm = line.strip()
        match_amount = re.search(full_pat, line_norm, re.IGNORECASE)
        match_label = re.search(label_pat, line_norm, re.IGNORECASE)

        # If we have a full match with currency, use it
        if match_amount:
            results.append({
                "label":   match_label.group(0).strip() if match_label else None,
                "montant": match_amount.group(0).strip(),
            })
        else:
            # Fallback: if there is a label but no currency, try to find a numeric-looking value
            if match_label:
                match_amount_simple = re.search(amount_pat, line_norm)
                if match_amount_simple:
                    # Normalize spaces in the amount (e.g., '21 7025' -> '217025')
                    mval = match_amount_simple.group(0).strip()
                    results.append({
                        "label": match_label.group(0).strip(),
                        "montant": mval
                    })
 
    # Dédoublonnage sur la valeur
    seen, unique = set(), []
    for r in results:
        if r["montant"] not in seen:
            seen.add(r["montant"])
            unique.append(r)
    return unique

def extract_dates(text: str) -> list[dict]:
    """
    Extrait les dates et associe un label contextuel si trouvé.
    Retourne une liste de dicts : {"label": ..., "date": ...}
    """

    # Motifs de date
    date_patterns = [
        r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',
        r'\d{4}[/-]\d{1,2}[/-]\d{1,2}',
    ]

    # Labels possibles
    labels = [
        r'Date d\'emission',
        r'Date d\'echeance',
        r'Valable jusqu[ -\']au',
        r'Document emis le',
        r'Date d\'immatriculation',
        r'Date de creation',
        r'Date d\'expiration'
    ]
    
    # On combine label + date
    combined_pattern = rf'({"|".join(labels)})\s*[:\-]?\s*({"|".join(date_patterns)})'

    matches = re.findall(combined_pattern, text, flags=re.IGNORECASE)

    results = []
    for label, date in matches:
        results.append({
            "label": label.strip(),
            "date": date.strip()
        })

    return results

def extract_soc(text: str) -> list:
    """
    Extrait les noms de sociétés depuis un texte OCR
    en utilisant uniquement :
    - les labels (Société, Client, Fournisseur…)
    - les formes juridiques (SARL, SAS, etc.)
    """

    soc = set()
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    #Patterns
    label_pattern = r'(?:société|raison sociale|entreprise|client|fournisseur)\s*[:\-]?\s*(.+)'
    legal_forms = r'(SARL|SAS|SA|EURL|SNC|SCI|SASU)'
    legal_pattern = rf'\b([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9\s&\-\']{{2,}}?\s+{legal_forms})\b'

  
    for line in lines:

        # Extraction via label
        match_label = re.search(label_pattern, line, re.IGNORECASE)
        if match_label:
            name = match_label.group(1).strip()
            name = re.split(r'[|,;]', name)[0]

            if 2 < len(name) < 100:
                soc.add(name)

        #Extraction via forme juridique
        match_legal = re.search(legal_pattern, line)
        if match_legal:
            soc.add(match_legal.group(1).strip())

    # Nettoyage
    cleaned = []
    for s in soc:
        s = s.strip(" :.-_")

        if len(s) < 3:
            continue
        if re.match(r'^\d+$', s):
            continue

        cleaned.append(s)

    return list(set(cleaned))


def extract_statut_siret(text: str) -> str:
    """
    Extrait le statut de l'établissement depuis une attestation SIRET.
    Retourne "ACTIF", "CESSE" ou None si non trouvé.
    """

    match = re.search(r'Statut\s*:\s*(\w+)', text)
    if match:
        return match.group(1).upper()  # -> "ACTIF" ou "CESSE"
    return None


def extract_payment_method(text: str) -> str:
    """
    Detecte le mode de paiement dans le texte.
    Retourne une chaîne (ex: 'Virement', 'CB', 'Chèque') ou None.
    """
    pm_keywords = [
        r'mode de paiement\s*[:\-]?\s*(.+)',
        r'par\s+virement', r'virement bancaire', r'virement',
        r'par\s+ch[eè]que', r'ch[eè]que', r'cb\b', r'carte', r'pr[eé]l[eè]vement', r'sepa', r'esp[eè]ces', r'especes'
    ]

    text_norm = text.replace('\u00A0', ' ').replace('\u202F', ' ')
    lines = [l.strip() for l in text_norm.splitlines() if l.strip()]

    # First try explicit 'Mode de paiement' line
    for line in lines:
        m = re.search(r'mode de paiement\s*[:\-]?\s*(.+)', line, re.IGNORECASE)
        if m:
            return m.group(1).strip()

    # Otherwise try keywords
    for kw in ['virement', 'virement bancaire', 'carte', 'cb', 'chèque', 'cheque', 'prélèvement', 'sepa', 'espèces', 'especes']:
        if re.search(rf'\b{kw}\b', text_norm, re.IGNORECASE):
            # normalize common forms
            if 'virement' in kw:
                return 'Virement'
            if kw in ['carte', 'cb']:
                return 'Carte/CB'
            if 'chèque' in kw or 'cheque' in kw:
                return 'Chèque'
            if 'prél' in kw or 'sepa' in kw:
                return 'Prélèvement/SEPA'
            if 'esp' in kw:
                return 'Espèces'

    return None


def extract_address(text: str) -> dict:
    """
    Tente d'extraire une adresse complète depuis le texte.
    Stratégie :
      - cherche une ligne commençant par 'Adresse' et renvoie la partie après ':'
      - sinon cherche un code postal FR (5 chiffres) et capture 1-2 lignes autour
    Retourne dict { full, street, postalCode, city } ou {} si non trouvé
    """
    text_norm = text.replace('\u00A0', ' ').replace('\u202F', ' ')
    lines = [l.strip() for l in text_norm.splitlines() if l.strip()]

    # Look for 'Adresse' label
    for i, line in enumerate(lines):
        m = re.search(r'Adresse\s*[:\-]?\s*(.+)', line, re.IGNORECASE)
        if m:
            full = m.group(1).strip()
            # if the address spills to next line(s), try to append next line if it looks like part of address
            if i+1 < len(lines) and re.search(r'\d{5}', lines[i+1]):
                full = full + ' ' + lines[i+1]
            return {'full': full}

    # Look for postal code lines
    for i, line in enumerate(lines):
        m = re.search(r'\b(\d{5})\b', line)
        if m:
            postal = m.group(1)
            # try to extract city from the same line
            city_match = re.search(r'\b\d{5}\s*(.+)', line)
            city = city_match.group(1).strip() if city_match else None
            # get previous line as street if available
            street = lines[i-1] if i-1 >= 0 else None
            full = ' '.join([p for p in [street, line] if p])
            return {'full': full, 'street': street, 'postalCode': postal, 'city': city}

    return {}


def detect_type(text: str) -> str:
    """
    Détecte le type de document à partir du texte OCR.
    Retourne: "facture", "devis", "urssaf", "siret", "kbis" ou "inconnu"
    """
    t = text.lower()

    if "facture n" in t and "fac-" in t:
        return "facture"
    if "devis n" in t and "dev-" in t:
        return "devis"
    if "attestation de vigilance" in t:
        return "urssaf"
    if "attestation d'immatriculation" in t:
        return "siret"
    if "extrait k-bis" in t:
        return "kbis"
    return "inconnu"


def extract_numero_document(text: str) -> dict:
    """
    Extrait le numéro complet ET la ref courte pour la liaison facture <-> devis.
    Retourne un dict avec:
      - "numero": numéro complet (ex: "FAC-0001-2025")
      - "ref": clé de liaison courte (ex: "0001-2025")
    Retourne None si non trouvé.
    """
    t = text.lower()

    match = re.search(r'(fac|dev)-(\d{4}-\d{4})', t)
    if match:
        prefix    = match.group(1).upper()   # "FAC" ou "DEV"
        ref_court = match.group(2)           # "0001-2025"
        numero    = f"{prefix}-{ref_court}"  # "FAC-0001-2025"

        return {
            "numero":   numero,      # numéro complet
            "ref":      ref_court    # clé de liaison
        }

    return None

