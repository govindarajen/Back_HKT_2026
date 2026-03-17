#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run OCR on a file and extract values using extraction_data.py
Usage:
  python scripts/test_script.py path/to/file
The script calls functions from scripts/test_fct.py to obtain text, then
passes the text to the extractors in scripts/extraction_data.py and prints
a JSON result.
"""
import sys
from pathlib import Path
import json

# make sure repo root is on sys.path
root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from scripts import test_fct
from scripts import extraction_data

def main():
    if len(sys.argv) < 2:
        print('Usage: python scripts/test_script.py <file>')
        sys.exit(1)
    file_path = Path(sys.argv[1])
    if not file_path.exists():
        print('File not found:', file_path)
        sys.exit(1)
    
    # Run OCR using existing logic in test_fct.py
    text = test_fct.process_file(file_path)
    if not text:
        print('No OCR text extracted')
        sys.exit(1)
    
    # Call extractors
    siret = extraction_data.extract_siret(text)
    montants = extraction_data.extract_montants(text)
    dates = extraction_data.extract_dates(text)
    societes = extraction_data.extract_soc(text)
    statut = extraction_data.extract_statut_siret(text)
    mode_paiement = extraction_data.extract_payment_method(text)
    address = extraction_data.extract_address(text)
    
    out = {
        'file': str(file_path),
        'siret': siret,
        'montants': montants,
        'dates': dates,
        'societes': societes,
        'statut_siret': statut,
        'mode_paiement': mode_paiement,
        'address': address,
        'preview': text[:1000]
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
