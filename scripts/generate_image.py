"""
Convertir les PDFs générés en images PNG pour simuler de vrais scans.
Chaque PDF donne deux versions :
    - une image propre  (pour tester l'extraction OCR dans de bonnes conditions
    - une image dégradée (pour tester la robustesse de Tesseract sur des scans réels)
"""

import os
from pdf2image import convert_from_path  # convertit chaque page PDF en objet PIL Image
from PIL import Image                    # manipulation d'images
import numpy as np                       # calcul matriciel pour le bruit


INPUT_DIR  = "./dataset"        # dossier contenant les PDFs générés par generate_doc.py
OUTPUT_DIR = "./dataset_images" # dossier de destination pour les images PNG


#fonction de dégradation
def add_noise(img):
    """
    Simule un scan de mauvaise qualité en ajoutant du bruit gaussien à l'image.

    Pourquoi c'est utile :
        Les vrais documents scannés ont toujours des imperfections (grain, légère
        surexposition, poussière). Tesseract doit être capable de les lire malgré ça.
        Cette fonction permet de tester la robustesse de l'OCR sans avoir de vrais scans.

    Paramètre :
        img (PIL.Image) : image propre en entrée

    Retourne :
        PIL.Image : image avec bruit ajouté
    """

    # Convertir l'image PIL en tableau numpy (matrice de pixels H x W x 3)
    arr = np.array(img)

    # Génèrer un tableau de bruit aléatoire de la même taille que l'image
    # Les valeurs vont de 0 à 29 → on soustrait 15 pour centrer autour de 0
    # Résultat : chaque pixel est modifié de -15 à +14 en intensité
    noise = np.random.randint(0, 30, arr.shape, dtype=np.uint8)

    # Appliquer le bruit sur l'image
    # np.clip garantit que les valeurs restent entre 0 et 255 (plage valide pour une image)
    # On cast en int16 avant l'addition pour éviter les overflows sur uint8
    noisy = np.clip(arr.astype(np.int16) + noise - 15, 0, 255).astype(np.uint8)

    # Reconvertir le tableau numpy en image PIL et la retourne
    return Image.fromarray(noisy)



# Parcourir chaque sous-dossier du dataset (factures/, devis/, siret/, etc.)
for folder in os.listdir(INPUT_DIR):

    folder_path = os.path.join(INPUT_DIR, folder)

    # Ignorer les fichiers éventuels à la racine, on ne traite que les dossiers
    if not os.path.isdir(folder_path):
        continue

    # Créer le dossier de sortie correspondant (ex: dataset_images/factures/)
    out_folder = os.path.join(OUTPUT_DIR, folder)
    os.makedirs(out_folder, exist_ok=True)

    # Parcourir chaque fichier PDF dans le sous-dossier
    for pdf_file in os.listdir(folder_path):

        # Ignorer tout fichier qui n'est pas un PDF
        if not pdf_file.endswith(".pdf"):
            continue

        pdf_path = os.path.join(folder_path, pdf_file)

        # Convertir toutes les pages du PDF en liste d'images PIL
        # dpi=150 → résolution typique d'un scanner bureau (bon compromis qualité / poids)
        pages = convert_from_path(pdf_path, dpi=150)

        for i, page in enumerate(pages):

            #version propre
            clean_name = pdf_file.replace(".pdf", f"_p{i+1}.png")
            page.save(os.path.join(out_folder, clean_name))

            #version dégradée
            #Appliquer le bruit puis sauvegarde avec le suffixe _scan
            noisy = add_noise(page)
            noisy_name = pdf_file.replace(".pdf", f"_p{i+1}_scan.png")
            noisy.save(os.path.join(out_folder, noisy_name))

            print(f"  ✅  {out_folder}/{clean_name}")

print("\n Images générées dans ./dataset_images/")