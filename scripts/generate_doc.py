"""
Générer des documents administratifs synthétiques en PDF.
"""

import sys
import os
import random
import string
from datetime import date, timedelta
from fpdf import FPDF
from faker import Faker

fake = Faker("fr_FR")

#GÉNÉRATEURS DE DONNÉES ALÉATOIRES

def rand_fournisseur():
    """Génère un fournisseur fictif réaliste avec Faker."""
    forme = random.choice(["SAS", "SARL", "SA", "EURL"])
    nom   = f"{fake.last_name().upper()} {fake.word().upper()} {forme}"
    return (
        nom,
        fake.street_address(),
        f"{fake.postcode()} {fake.city()}"
    )

def rand_siret():
    """Faker génère directement un SIRET formaté."""
    return fake.siret()  # ← format correct XXX XXX XXX XXXXX

def rand_iban():
    """Faker génère un IBAN français valide."""
    return fake.iban()

def rand_tva(siret):
    """
    TVA intracommunautaire française.
    Formule officielle : cle = (12 + 3 * SIREN) mod 97
    Format : FR + cle(2 chiffres) + SIREN(9 chiffres)
    """
    siren_clean = siret.replace(" ", "")[:9]
    key = (12 + 3 * int(siren_clean)) % 97
    return f"FR{key:02d}{siren_clean}"

def rand_bic():
    """Code BIC/SWIFT : 8 lettres majuscules aléatoires."""
    return "".join(random.choices(string.ascii_uppercase, k=8))

def past_date(months=0):
    """Date dans le passé (0 = aujourd'hui, 4 = il y a ~4 mois)."""
    return date.today() - timedelta(days=months * 30)

def rand_amount():
    """
    Montants B2B réalistes.
    Retourne (ht, tva, ttc) — TVA à 20%, arrondis à 2 décimales.
    """
    ht  = round(random.uniform(200, 15000), 2)
    tva = round(ht * 0.20, 2)
    ttc = round(ht + tva, 2)
    return ht, tva, ttc

#CLASSE PDF DE BASE
class DocPDF(FPDF):
    """
    Hérite de FPDF et fournit des méthodes communes à tous les documents :
    - footer()         : numéro de page automatique
    - section_title()  : bandeau bleu avec titre blanc
    - kv()             : ligne clé / valeur alignée
    """
    def __init__(self):
        super().__init__()

        # charger les polices DejaVu
        self.add_font(
            "DejaVu",
            "",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        )

        self.add_font(
            "DejaVu",
            "B",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        )

    def header(self):
        pass  # chaque make_xxx() gère son propre en-tête

    def footer(self):
        """Numéro de page centré en bas, gris clair."""
        self.set_y(-15)
        self.set_font("DejaVu", "", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section_title(self, title):
        """
        Bandeau pleine largeur fond bleu / texte blanc.
        Remet la couleur en noir après l'appel.
        """
        self.set_fill_color(30, 80, 160)
        self.set_text_color(255, 255, 255)
        self.set_font("DejaVu", "B", 11)
        self.cell(0, 8, f"  {title}", fill=True, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def kv(self, key, value, bold_value=False):

        value = str(value) if value else ""

        # clé
        self.set_font("DejaVu", "B", 10)
        self.cell(65, 7, key + " :", border=0)

        # valeur
        self.set_font("DejaVu", "B" if bold_value else "", 10)
        self.cell(0, 7, value, new_x="LMARGIN", new_y="NEXT")


#RIB
def add_rib_page(pdf, fournisseur, siret, emit_date):
    """
    Ajoute une page RIB dans un PDF existant
    """

    pdf.add_page()

    pdf.set_fill_color(220, 250, 240)
    pdf.set_font("DejaVu", "B", 16)
    pdf.cell(0, 12, "RELEVE D'IDENTITE BANCAIRE (RIB)", fill=True,
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    iban = rand_iban()
    bic  = rand_bic()
    bank = random.choice([
        "BNP Paribas", "Societe Generale", "Credit Agricole",
        "LCL", "CIC", "Banque Populaire"
    ])

    code_banque  = "".join(random.choices(string.digits, k=5))
    code_guichet = "".join(random.choices(string.digits, k=5))
    n_compte     = "".join(random.choices(string.digits + string.ascii_uppercase, k=11))
    cle_rib      = "".join(random.choices(string.digits, k=2))

    pdf.section_title("TITULAIRE DU COMPTE")
    pdf.kv("Raison sociale", fournisseur[0])
    pdf.kv("SIRET",          siret)
    pdf.kv("Adresse",        f"{fournisseur[1]}, {fournisseur[2]}")
    pdf.ln(3)

    pdf.section_title("COORDONNEES BANCAIRES")
    pdf.kv("Etablissement", bank)
    pdf.kv("Code banque",   code_banque)
    pdf.kv("Code guichet",  code_guichet)
    pdf.kv("N de compte",   n_compte)
    pdf.kv("Cle RIB",       cle_rib)
    pdf.ln(3)

    pdf.kv("IBAN",        iban, bold_value=True)
    pdf.kv("BIC / SWIFT", bic,  bold_value=True)
    pdf.ln(6)

    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(0, 6,
        f"Document emis le {emit_date.strftime('%d/%m/%Y')} par {bank}. "
        "Ce RIB est fourni a des fins de reglement et de domiciliation.")


#FACTURE FOURNISSEUR
def make_facture(idx, fournisseur, siret, tva_num, ht, tva_val, ttc, emit_date):
    """
    Facture émise par le fournisseur à destination de l'entreprise cliente.

    Pas de SIRET client : il est connu via le compte connecté sur la plateforme.

    Champs extraits par l'OCR :
        SIRET fournisseur, N° facture, date émission, date échéance,
        montant HT, TVA, TTC, mode de paiement.

    Vérifications possibles en aval :
        - Montant TTC <= montant du devis associé
        - N° facture non déjà présent en base (détection doublon)
        - Date échéance non dépassée
    """
    pdf = DocPDF()
    pdf.add_page()

    #En-tête fournisseur
    pdf.set_fill_color(240, 245, 255)
    pdf.set_font("DejaVu", "B", 18)
    pdf.cell(0, 12, fournisseur[0], fill=True, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "", 10)
    pdf.cell(0, 6, f"{fournisseur[2]}  —  {fournisseur[1]}",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "B", 10)
    pdf.cell(0, 6, f"SIRET : {siret}   |   TVA : {tva_num}",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)

    #Identification de la facture
    pdf.section_title(f"FACTURE N  FAC-{idx:04d}-{emit_date.year}")
    pdf.kv("Date d'emission",  emit_date.strftime("%d/%m/%Y"))
    # Echeance standard : 30 jours après émission (article L441-10 Code de Commerce)
    pdf.kv("Date d'echeance",  (emit_date + timedelta(days=30)).strftime("%d/%m/%Y"))
    pdf.ln(3)

    #Détail des prestations
    pdf.section_title("DETAIL DES PRESTATIONS")
    headers = ["Description", "Qte", "PU HT (€)", "Total HT (€)"]
    widths  = [90, 20, 40, 40]
    pdf.set_fill_color(210, 220, 240)
    pdf.set_font("DejaVu", "B", 10)
    for h, w in zip(headers, widths):
        pdf.cell(w, 8, h, border=1, fill=True, align="C")
    pdf.ln()
    pdf.set_font("DejaVu", "", 10)
    # Les 3 lignes se répartissent 40% / 35% / 25% du montant HT total
    items = [
        ("Prestation de service informatique", 3, round(ht * 0.4 / 3, 2)),
        ("Licence logicielle annuelle",         1, round(ht * 0.35, 2)),
        ("Support et maintenance",              2, round(ht * 0.25 / 2, 2)),
    ]
    for desc, qty, pu in items:
        for cell, w in zip([desc, str(qty), f"{pu:.2f}", f"{qty*pu:.2f}"], widths):
            pdf.cell(w, 7, cell, border=1)
        pdf.ln()

    #Récapitulatif
    pdf.ln(4)
    pdf.section_title("RÉCAPITULATIF")
    pdf.kv("Montant HT",   f"{ht:.2f} €", bold_value=True)
    pdf.kv("TVA (20 %)",   f"{tva_val:.2f} €")
    pdf.kv("Montant TTC",  f"{ttc:.2f} €", bold_value=True)
    pdf.ln(4)
    pdf.kv("Mode de paiement", "Virement bancaire 30 jours")

    add_rib_page(pdf, fournisseur, siret, emit_date)

    return pdf


#DEVIS
def make_devis(idx, fournisseur, siret, tva_num, ht, tva_val, ttc, emit_date):
    """
    Devis émis par le fournisseur avant la facture.

    Différences clés vs facture :
        - Date de validité (90 jours) au lieu d'une échéance
        - Mention légale d'acceptation en bas

    Vérifications possibles en aval :
        - SIRET = celui de la facture associée (même fournisseur ?)
        - Montant TTC devis >= montant TTC facture (pas de dépassement ?)
        - Date validité non expirée au moment de la facturation
    """
    pdf = DocPDF()
    pdf.add_page()

    #En-tête fournisseur
    pdf.set_fill_color(245, 250, 240)
    pdf.set_font("DejaVu", "B", 18)
    pdf.cell(0, 12, fournisseur[0], fill=True, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "", 10)
    pdf.cell(0, 6, f"{fournisseur[2]}  —  {fournisseur[1]}",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "B", 10)
    pdf.cell(0, 6, f"SIRET : {siret}   |   TVA : {tva_num}",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)

    #Identification du devis
    pdf.section_title(f"DEVIS N  DEV-{idx:04d}-{emit_date.year}")
    pdf.kv("Date d'emission",  emit_date.strftime("%d/%m/%Y"))
    # Validité 90 jours = délai commercial standard
    pdf.kv("Valable jusqu'au", (emit_date + timedelta(days=90)).strftime("%d/%m/%Y"))
    pdf.ln(3)


    #Prestations proposées
    pdf.section_title("PRESTATIONS PROPOSEES")
    headers = ["Description", "Qte", "PU HT (EUR)", "Total HT (EUR)"]
    widths  = [90, 20, 40, 40]
    pdf.set_fill_color(210, 235, 210)
    pdf.set_font("DejaVu", "B", 10)
    for h, w in zip(headers, widths):
        pdf.cell(w, 8, h, border=1, fill=True, align="C")
    pdf.ln()
    pdf.set_font("DejaVu", "", 10)
    for desc, qty, pu in [
        ("Audit systeme d'information", 1, round(ht * 0.5, 2)),
        ("Formation equipe (2 jours)",  2, round(ht * 0.3 / 2, 2)),
        ("Documentation technique",     1, round(ht * 0.2, 2)),
    ]:
        for cell, w in zip([desc, str(qty), f"{pu:.2f}", f"{qty*pu:.2f}"], widths):
            pdf.cell(w, 7, cell, border=1)
        pdf.ln()

    #Total
    pdf.ln(4)
    pdf.section_title("TOTAL")
    pdf.kv("Montant HT",  f"{ht:.2f} EUR",      bold_value=True)
    pdf.kv("TVA (20%)",   f"{tva_val:.2f} EUR")
    pdf.kv("Montant TTC", f"{ttc:.2f} EUR",      bold_value=True)
    pdf.ln(4)
    pdf.set_font("DejaVu", "", 9)
    pdf.multi_cell(0, 6,
        "Ce devis est valable 90 jours a compter de sa date d'emission. "
        "La signature du present document vaut acceptation des CGV.")

    return pdf

#ATTESTATION SIRET
def make_siret(idx, fournisseur, siret, tva_num, emit_date, statut="ACTIF"):
    """
    Attestation d'immatriculation au répertoire SIRENE (INSEE).

    Prouve que le fournisseur existe et est actif.

    Vérifications possibles en aval :
        - SIRET = celui présent sur la facture/Kbis/URSSAF
        - Statut = "ACTIF" (si "CESSE" -> alerte critique)
    """
    pdf = DocPDF()
    pdf.add_page()

    pdf.set_fill_color(255, 248, 220)
    pdf.set_font("DejaVu", "B", 16)
    pdf.cell(0, 12, "ATTESTATION D'IMMATRICULATION", fill=True,
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "", 10)
    pdf.cell(0, 6, "Systeme National d'Identification et du Repertoire des Entreprises",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    pdf.section_title("IDENTIFICATION DU FOURNISSEUR")
    pdf.kv("Numero SIRET",             siret, bold_value=True)
    # SIREN = 9 premiers chiffres du SIRET
    pdf.kv("Numero SIREN",             siret.replace(" ", "")[:9])
    pdf.kv("Denomination",             fournisseur[0])
    pdf.kv("Adresse",                  fournisseur[1])
    pdf.kv("Code postal / Ville",      fournisseur[2])
    pdf.kv("N TVA Intracommunautaire", tva_num)
    pdf.ln(3)

    pdf.section_title("ETAT DE L'ETABLISSEMENT")
    pdf.kv("Statut",  statut, bold_value=True)  # ACTIF ou CESSE -> champ critique
    pdf.kv("Date de creation",
           (emit_date - timedelta(days=random.randint(365, 3650))).strftime("%d/%m/%Y"))
    # Code APE = activité principale selon la nomenclature NAF française
    pdf.kv("Activite principale (APE)",
           f"{random.randint(60,96)}.{random.randint(10,99)}Z")
    pdf.kv("Forme juridique",
           random.choice(["SAS", "SARL", "SA", "EURL"]))
    pdf.ln(6)

    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(0, 6,
        f"Attestation generee le {emit_date.strftime('%d/%m/%Y')} "
        f"via le repertoire SIRENE (INSEE). Document fourni a titre informatif.")
    return pdf

#ATTESTATION DE VIGILANCE URSSAF
def make_urssaf(idx, fournisseur, siret, emit_date):
    """
    Attestation certifiant que le fournisseur est à jour de ses cotisations sociales.
    Obligatoire pour tout contrat > 5 000 EUR HT.

    Vérifications possibles en aval :
        - SIRET = celui de la facture/Kbis
        - Date d'expiration > date du jour (si dépassée -> paiement bloqué légalement)
    """
    pdf = DocPDF()
    pdf.add_page()

    pdf.set_fill_color(220, 235, 255)
    pdf.set_font("DejaVu", "B", 16)
    pdf.cell(0, 12, "ATTESTATION DE VIGILANCE", fill=True,
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "", 10)
    pdf.cell(0, 6, "URSSAF - Union de Recouvrement des Cotisations de Securite Sociale",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    # Durée légale de validité d'une attestation URSSAF = 6 mois
    expiry = emit_date + timedelta(days=180)

    pdf.section_title("FOURNISSEUR")
    pdf.kv("Raison sociale",   fournisseur[0])
    pdf.kv("Numero SIRET",     siret, bold_value=True)
    pdf.kv("Adresse du siege", f"{fournisseur[1]}, {fournisseur[2]}")
    pdf.ln(3)

    pdf.section_title("ATTESTATION")
    pdf.set_font("DejaVu", "", 10)
    pdf.multi_cell(0, 7,
        f"L'URSSAF certifie que {fournisseur[0]} (SIRET : {siret}) "
        f"est a jour de ses obligations declaratives et de paiement des "
        f"cotisations sociales a la date du {emit_date.strftime('%d/%m/%Y')}.")
    pdf.ln(3)

    pdf.section_title("VALIDITE")
    pdf.kv("Date d'emission",   emit_date.strftime("%d/%m/%Y"))
    # Date d'expiration : champ le plus critique pour la détection d'anomalie
    pdf.kv("Date d'expiration", expiry.strftime("%d/%m/%Y"), bold_value=True)
    pdf.ln(6)

    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(0, 6,
        "Document delivre conformement a l'article L.243-15 du Code de la Securite Sociale. ")
    return pdf

#EXTRAIT KBIS
def make_kbis(idx, fournisseur, siret, tva_num, emit_date):
    """
    Carte d'identité officielle de l'entreprise fournisseur,
    délivrée par le Greffe du Tribunal de Commerce.

    Vérifications possibles en aval :
        - SIRET = celui de la facture/URSSAF/RIB
        - Dénomination sociale = nom affiché sur la facture
        - Dirigeant cohérent avec d'autres documents internes éventuels
    """
    pdf = DocPDF()
    pdf.add_page()

    pdf.set_fill_color(235, 220, 255)
    pdf.set_font("DejaVu", "B", 16)
    pdf.cell(0, 12, "EXTRAIT K-BIS", fill=True, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("DejaVu", "", 10)
    pdf.cell(0, 6, "Registre du Commerce et des Societes (RCS)",
             align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    greffe_city = fournisseur[2].split()[-1]  # extrait la ville du champ "CP Ville"
    capital     = random.choice([1000, 5000, 10000, 50000, 100000])

    pdf.section_title("IDENTIFICATION")
    pdf.kv("Denomination sociale", fournisseur[0])
    pdf.kv("Forme juridique",      random.choice(["SAS", "SARL", "SA", "EURL"]))
    pdf.kv("Capital social",       f"{capital:,} EUR".replace(",", " "))
    pdf.kv("Siege social",         f"{fournisseur[1]}, {fournisseur[2]}")
    pdf.kv("N SIRET",              siret, bold_value=True)
    pdf.kv("N TVA",                tva_num)
    pdf.ln(3)

    pdf.section_title("INSCRIPTION AU RCS")
    pdf.kv("Greffe",  greffe_city)
    # Format RCS officiel : "RCS [Ville] B [SIREN]"
    pdf.kv("N RCS",   f"RCS {greffe_city} B {siret.replace(' ', '')[:9]}")
    pdf.kv("Date d'immatriculation",
           (emit_date - timedelta(days=random.randint(365, 3650))).strftime("%d/%m/%Y"))
    pdf.kv("Activite declaree",
           random.choice([
               "Conseil en systemes et logiciels informatiques",
               "Activites de conseil pour les affaires et la gestion",
               "Travaux de construction",
               "Transport de marchandises",
           ]))
    pdf.ln(3)

    pdf.section_title("DIRIGEANT")
    first = random.choice(["Jean", "Marie", "Pierre", "Sophie", "Nicolas"])
    last  = random.choice(["Martin", "Bernard", "Dupont", "Lambert", "Rousseau"])
    pdf.kv("President / Gerant", f"{first} {last}")
    # Age entre ~33 et ~55 ans (12 000 à 20 000 jours)
    pdf.kv("Date de naissance",
           (emit_date - timedelta(days=random.randint(12000, 20000))).strftime("%d/%m/%Y"))
    pdf.ln(6)

    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(0, 6,
        f"Extrait delivre le {emit_date.strftime('%d/%m/%Y')} "
        f"par le Greffe du Tribunal de Commerce de {greffe_city}. "
        "Document certifie conforme.")
    return pdf


#REGISTRE — associe chaque dossier à sa fonction de génération
GENERATORS = {
    "factures": make_facture,
    "devis":    make_devis,
    "siret":    make_siret,
    "urssaf":   make_urssaf,
    "kbis":     make_kbis,
}

def main(anomalie=False):

    BASE_DIR = "./dataset_anomalies" if anomalie else "./dataset"
    random.seed(45)

    for folder in GENERATORS:
        os.makedirs(os.path.join(BASE_DIR, folder), exist_ok=True)

    for i in range(11, 16):
        fournisseur      = rand_fournisseur()
        siret            = rand_siret()
        tva_num          = rand_tva(siret)
        ht, tva_val, ttc = rand_amount()
        emit_date        = past_date(random.randint(0, 4))
        ttc_casse = ttc
        emit_date_casse = emit_date

        # ── si anomalie=True on injecte des cas cassés ────────────────────
        if anomalie:
            if i == 11:
                emit_date_casse = past_date(8)   # URSSAF expirée dans 2 mois passés
            if i == 12:
                ttc_casse = ttc * 2              # facture TTC double du devis → MONTANT_DEPASSE
            if i == 13:
                emit_date_casse = past_date(7)   # devis émis il y a 7 mois → DEVIS_EXPIRE

        docs = {
            "factures": make_facture(i, fournisseur, siret, tva_num, ht, tva_val, ttc_casse if anomalie else ttc, emit_date),
            "devis":    make_devis(i, fournisseur, siret, tva_num, ht, tva_val, ttc, emit_date_casse if anomalie else emit_date),
            "siret":    make_siret(i, fournisseur, siret, tva_num, emit_date,
                                   statut="CESSE" if anomalie and i == 14 else "ACTIF"),
            "urssaf":   make_urssaf(i, fournisseur, siret, emit_date_casse if anomalie else emit_date),
            "kbis":     make_kbis(i, fournisseur, siret, tva_num, emit_date),
        }

        for dtype, pdf in docs.items():
            prefix   = dtype[:-1] if dtype.endswith("s") else dtype
            filename = f"{prefix}_{i:03d}.pdf"
            path     = os.path.join(BASE_DIR, dtype, filename)
            pdf.output(path)
            print(f"  OK  {path}")


if __name__ == "__main__":
    # python generate_documents.py          → documents cohérents
    # python generate_documents.py anomalie → documents avec anomalies
    anomalie = len(sys.argv) > 1 and sys.argv[1] == "anomalie"
    main(anomalie=anomalie)
