#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import os
import argparse
import shutil
from pathlib import Path
import re

# Force UTF-8 encoding for Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8') 

#outils du ocr
import pytesseract
from PIL import Image
from pdf2image import convert_from_path




pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
os.environ["TESSDATA_PREFIX"] = r"C:\Program Files\Tesseract-OCR\tessdata"

# Detect Poppler (pdfinfo / pdftoppm) location so pdf2image can use it. This helps when
# the script is run from environments that don't have Poppler in PATH (e.g. services spawned
# by Node). We try `shutil.which('pdfinfo')`, then common install locations.
poppler_path = None
pdfinfo_exe = shutil.which('pdfinfo') or shutil.which('pdfinfo.exe')
if pdfinfo_exe:
    poppler_path = str(Path(pdfinfo_exe).parent)
else:
    candidates = [
        r"C:\poppler\poppler-24.02.0\Library\bin",
        os.path.join(os.environ.get('ProgramFiles', r"C:\Program Files"), 'poppler', 'bin'),
        os.path.join(Path.home(), 'scoop', 'shims')
    ]
    for cand in candidates:
        try:
            if os.path.exists(os.path.join(cand, 'pdfinfo.exe')) or os.path.exists(os.path.join(cand, 'pdfinfo')):
                poppler_path = cand
                break
        except Exception:
            continue

# If we found a poppler folder, ensure it's in PATH for subprocesses
if poppler_path:
    if os.environ.get('PATH') and poppler_path in os.environ.get('PATH'):
        pass
    else:
        os.environ['PATH'] = (os.environ.get('PATH', '') + os.pathsep + poppler_path).lstrip(os.pathsep)



IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp", ".gif"}
PDF_EXTENSION = ".pdf"


def normalize_text(text: str) -> str:
    """
    Normalise le texte OCR :
    - remplace les espaces insécables par des espaces normaux
    - supprime les espaces multiples
    - corrige les confusions OCR courantes sur les chiffres
    """
    text = text.replace('\xa0', ' ')    # espace insécable
    text = text.replace('\u202f', ' ')  # espace fine insécable
    text = re.sub(r' +', ' ', text)     # espaces multiples
    # Corrections OCR courantes entre chiffres
    text = re.sub(r'(?<=\d)O(?=\d)', '0', text) #(?<=\d):chiffre AVANT / (?=\d):chiffre APRÈS
    text = re.sub(r'(?<=\d)l(?=\d)',  '1', text)
    text = re.sub(r'(?<=\d)I(?=\d)',  '1', text)
    return text

def extract_from_image(path: Path) -> str:
    """Extrait le texte d'une image."""

    img = Image.open(path)
    text = pytesseract.image_to_string(img, lang="fra")
    return normalize_text(text.strip())


def extract_from_pdf(path: Path) -> str:
    """Extrait le texte d'un PDF (scanné ou texte natif) via Tesseract."""

    print(f"Conversion du PDF en images...")
    # pass poppler_path if detected; convert_from_path accepts None as default
    pages = convert_from_path(str(path), dpi=300, poppler_path=poppler_path)

    all_text = []
    for i, page_img in enumerate(pages, start=1):
        print(f"OCR page {i}/{len(pages)}...")
        text = pytesseract.image_to_string(page_img, lang="fra")
        all_text.append(f"--- Page {i} ---\n{text.strip()}")

    return "\n\n".join(all_text)


def process_file(path: Path) -> str | None:
    """Détecte le type de fichier et lance l'OCR approprié."""
    ext = path.suffix.lower()

    if ext == PDF_EXTENSION:
        print(f"PDF détecté : {path.name}")
        return extract_from_pdf(path)
    elif ext in IMAGE_EXTENSIONS:
        print(f"Image détectée : {path.name}")
        return extract_from_image(path)
    else:
        print(f"Format non supporté : {path.name} (ignoré)")
        return None


if __name__ == '__main__':
    """Test direct : python scripts/test_fct.py <chemin_fichier> [--save output.txt]"""
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_fct.py <chemin_image_ou_pdf> [--save fichier_sortie.txt]")
        print("\nExemples:")
        print("  python scripts/test_fct.py test_images/facture.png")
        print("  python scripts/test_fct.py test_images/facture.pdf")
        print("  python scripts/test_fct.py test_images/facture.png --save result.txt")
        sys.exit(1)
    
    file_path = Path(sys.argv[1])
    output_path = None
    
    # Vérifie si --save est présent
    if '--save' in sys.argv:
        idx = sys.argv.index('--save')
        if idx + 1 < len(sys.argv):
            output_path = Path(sys.argv[idx + 1])
    
    # Vérifie que le fichier existe
    if not file_path.exists():
        print(f"ERROR: Le fichier n'existe pas: {file_path}")
        sys.exit(1)
    
    print(f"Processing: {file_path.name}")
    print("-" * 60)
    
    # Lance l'OCR
    result = process_file(file_path)
    
    if result:
        print("\nOCR RESULT:\n")
        print(result)
        
        # Sauvegarde si demandé
        if output_path:
            output_path.write_text(result, encoding='utf-8')
            print(f"\nResult saved to: {output_path}")
    else:
        print("ERROR: No result or unsupported format")
        sys.exit(1)
