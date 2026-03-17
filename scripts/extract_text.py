#!/usr/bin/env python3
"""Read OCR text from a file or stdin, run extraction functions and output JSON.

Usage:
  python scripts/extract_text.py --file path/to/text.txt
  cat text.txt | python scripts/extract_text.py
"""
import sys
import json
from pathlib import Path

# Ensure package import path
root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from scripts import extraction_data

def read_input(path=None):
    # Treat '-' as stdin (compatible with many CLI tools)
    if not path or path == '-':
        # Read raw bytes and try UTF-8 then fallback to cp1252, normalize NBSPs
        data = sys.stdin.buffer.read()
        try:
            text = data.decode('utf-8')
        except Exception:
            try:
                text = data.decode('cp1252')
            except Exception:
                text = data.decode('utf-8', errors='ignore')
        return text.replace('\u00A0', ' ').replace('\u202F', ' ')
    return Path(path).read_text(encoding='utf-8')

def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--file', '-f', help='Path to text file (optional)')
    args = p.parse_args()

    text = read_input(args.file)
    if not text:
        print(json.dumps({'error': 'no text provided'}))
        return

    out = {
        'siret': extraction_data.extract_siret(text),
        'montants': extraction_data.extract_montants(text),
        'dates': extraction_data.extract_dates(text),
        'societes': extraction_data.extract_soc(text),
        'statut_siret': extraction_data.extract_statut_siret(text),
        'mode_paiement': extraction_data.extract_payment_method(text),
    }

    print(json.dumps(out, ensure_ascii=False))

if __name__ == '__main__':
    main()
