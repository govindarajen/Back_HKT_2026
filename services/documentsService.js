const mongoose = require('mongoose');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const RawDocument = require('../models/RawDocument');
const CleanDocument = require('../models/CleanDocument');

const ALLOWED_DOCUMENT_TYPES = new Set([
  'facture_fournisseur',
  'devis',
  'attestation_siret',
  'attestation_urssaf',
  'extrait_kbis',
  'rib',
  'autre',
]);

const DOCUMENT_TYPE_ALIASES = {
  facture: 'facture_fournisseur',
  attestation: 'attestation_urssaf',
  file: null,
  files: null,
};

function resolveDocumentType(file, body) {
  const candidates = [];

  if (body?.type) candidates.push(body.type);
  if (body?.documentType) candidates.push(body.documentType);
  if (file?.fieldname) candidates.push(file.fieldname);

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = DOCUMENT_TYPE_ALIASES[candidate] ?? candidate;
    if (normalized && ALLOWED_DOCUMENT_TYPES.has(normalized)) {
      return normalized;
    }
  }

  return 'autre';
}
const CuratedDocument = require('../models/CuratedDocument');

// Helper: parse date string in DD/MM/YYYY format to Date object
function parseDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  // Try to match DD/MM/YYYY format
  const match = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const date = new Date(year, month - 1, day);
    // Verify the date is valid
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

// Helper: normalize label (remove accents-ish and punctuation) for matching
function normLabel(lbl) {
  if (!lbl) return '';
  return String(lbl).toLowerCase()
    .replace(/[\u00E9\u00E8\u00EA\u00EB]/g, 'e')
    .replace(/[\u00E0\u00E2\u00E4]/g, 'a')
    .replace(/[\u00F4\u00F6]/g, 'o')
    .replace(/[\u00E7]/g, 'c')
    .replace(/[^a-z0-9 ]/g, ' ');
}

// Helper: parse monetary string to Number (float)
function parseAmountString(str) {
  if (!str || typeof str !== 'string') return null;
  // Remove currency symbols and trim
  let s = str.replace(/€/g, '').replace(/EUR/ig, '').trim();
  // Normalize whitespace and NBSPs
  s = s.replace(/\u00A0|\u202F/g, ' ').replace(/\s+/g, '');

  // If both '.' and ',' present, decide which is decimal separator by last occurrence
  const hasDot = s.indexOf('.') !== -1;
  const hasComma = s.indexOf(',') !== -1;
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      // comma is decimal separator, remove dots (thousand sep) and replace comma
      s = s.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // dot is decimal separator, remove commas
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // only comma -> decimal
    s = s.replace(/,/g, '.');
  }

  // Remove any remaining non-digit (except dot and minus)
  s = s.replace(/[^0-9.\-]/g, '');
  // If multiple dots remain (ambiguous), remove all but last
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 1) {
    const parts = s.split('.');
    const last = parts.pop();
    s = parts.join('') + '.' + last;
  }

  const v = parseFloat(s);
  if (Number.isFinite(v)) return v;

  // Fallback: extract first numeric-like substring and try again
  const m = str.match(/\d+[\d\s\.,\u00A0\u202F]*\d*/);
  if (m) {
    const candidate = m[0].replace(/\u00A0|\u202F/g, '').replace(/\s+/g, '');
    // Try same normalization on candidate
    return parseAmountString(candidate);
  }

  return null;
}

async function uploadBufferToGridFS(filename, buffer, contentType, metadata = {}) {
  const db = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'rawFiles' });
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: contentType,
      metadata: metadata
    });

    uploadStream.on('error', (error) => {
      console.error('GridFS upload error:', error);
      reject(error);
    });

    uploadStream.on('finish', () => {
      resolve(uploadStream.id);
    });

    uploadStream.end(buffer);
  });
}

function performOcrOnBuffer(buffer, mimetype, originalname) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'test_fct.py');
    const tempFile = path.join(os.tmpdir(), `ocr_input_${Date.now()}_${path.basename(originalname)}`);
    const outputFile = tempFile + '.txt';

    const env = { ...process.env };
    if (mimetype) env.INPUT_MIMETYPE = mimetype;

    try {
      fs.writeFileSync(tempFile, buffer);

      let pythonExecutable = null;
      try {
        const venvPython = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
        if (fs.existsSync(venvPython)) {
          pythonExecutable = venvPython;
        } else {
          // Try to locate 'python' on PATH
          try {
            const wherePython = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['python'], { encoding: 'utf8' });
            if (wherePython.status === 0 && wherePython.stdout) {
              const candidate = wherePython.stdout.split(/\r?\n/)[0].trim();
              if (candidate) pythonExecutable = candidate;
            }
          } catch (e) {}

          // Fallback to 'py' launcher on Windows
          if (!pythonExecutable && process.platform === 'win32') {
            try {
              const wherePy = spawnSync('where', ['py'], { encoding: 'utf8' });
              if (wherePy.status === 0 && wherePy.stdout) {
                const candidate = wherePy.stdout.split(/\r?\n/)[0].trim();
                if (candidate) pythonExecutable = candidate;
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        // ignore and let pythonExecutable possibly be null
      }

      if (!pythonExecutable) {
        console.error('[OCR] No python executable found to spawn. Please ensure Python is installed or a .venv exists.');
        try { fs.unlinkSync(tempFile); } catch (e) {}
        resolve('');
        return;
      }

      const pythonProcess = spawn(pythonExecutable, [
        scriptPath,
        tempFile,
        '--save',
        outputFile
      ], {
        cwd: path.join(__dirname, '..'), // Exécute depuis le répertoire du projet
        env
      });
      
      let errorOutput = '';
      
      // Collect stderr from the Python process for later error reporting.
      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        
        // Nettoie le fichier temporaire d'entrée
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.error(`[OCR] Error deleting temp input file: ${e.message}`);
        }
        
        if (code !== 0) {
          console.error(`[OCR] Python script failed (code ${code}):`, errorOutput);
          resolve('');
          return;
        }
        
        // Lit le fichier de résultat
        try {
          if (fs.existsSync(outputFile)) {
            const ocrText = fs.readFileSync(outputFile, 'utf-8');
            
            // Nettoie le fichier de résultat
            try {
              fs.unlinkSync(outputFile);
            } catch (e) {
              console.error(`[OCR] Error deleting output file: ${e.message}`);
            }
            
            resolve(ocrText.trim());
          } else {
            console.error(`[OCR] Output file not found: ${outputFile}`);
            resolve('');
          }
        } catch (err) {
          console.error(`[OCR] Error reading output file: ${err.message}`);
          resolve('');
        }
      });
      
      pythonProcess.on('error', (err) => {
        console.error(`[OCR] Process error: ${err.message}`);
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {}
        resolve('');
      });
      
    } catch (err) {
      console.error(`[OCR] Unexpected error: ${err.message}`);
      resolve('');
    }
  });
}

async function uploadFile({ file, body, user }) {
  return new Promise(async (resolve, reject) => {
    if (!file) {
      return reject(new Error('No file provided'));
    }

    try {
      const docType = body?.type || 'autre';

      const fileId = await uploadBufferToGridFS(file.originalname, file.buffer, file.mimetype, { uploadedBy: user?.id });

      const rawDoc = new RawDocument({
        filename: file.originalname,
        type: docType,
        uploadedBy: user?.id,
        uploadedBySnapshot: { username: user?.username || '', fullName: user?.fullName || '' },
        uploadDate: new Date(),
        fileUrl: fileId.toString(),
        metadata: { originalname: file.originalname, mimetype: file.mimetype, size: file.size },
        enterpriseId: user?.enterpriseId,
        status: 'queued'
      });
      await rawDoc.save();

      const ocrText = await performOcrOnBuffer(file.buffer, file.mimetype, file.originalname);

      const cleanDoc = new CleanDocument({
        rawId: rawDoc._id,
        ocrText,
        jsonExtracted: {},
        extractionDate: new Date(),
        status: 'processed',
        enterpriseId: user?.enterpriseId
      });
      await cleanDoc.save();

      // Post-process: call Python extractor
      const extractorPath = path.join(__dirname, '../scripts/extract_text.py');
      let pythonExecutable = null;
      const venvPython = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
      if (fs.existsSync(venvPython)) {
        pythonExecutable = venvPython;
      } else {
        // Fallback logic to find python
        try {
          const wherePython = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['python'], { encoding: 'utf8' });
          if (wherePython.status === 0 && wherePython.stdout) {
            pythonExecutable = wherePython.stdout.split(/\r?\n/)[0].trim();
          }
        } catch (e) {}
        if (!pythonExecutable && process.platform === 'win32') {
          try {
            const wherePy = spawnSync('where', ['py'], { encoding: 'utf8' });
            if (wherePy.status === 0 && wherePy.stdout) pythonExecutable = wherePy.stdout.split(/\r?\n/)[0].trim();
          } catch (e) {}
        }
      }

      if (!pythonExecutable) {
        console.error('[Extractor] No python executable found.');
        // Still resolve with what we have, but curated will be missing
        return resolve({ rawId: rawDoc._id, cleanId: cleanDoc._id, curatedId: null });
      }

      console.log('[Extractor] sending OCR text preview:', ocrText ? ocrText.slice(0, 500) : '[empty]');

      const extractorProc = spawn(pythonExecutable, [extractorPath, '--file', '-'], { cwd: path.join(__dirname, '..') });
      let extractorOut = '';
      let extractorErr = '';

      extractorProc.stdout.on('data', (d) => extractorOut += d.toString('utf8'));
      extractorProc.stderr.on('data', (d) => extractorErr += d.toString('utf8'));

      extractorProc.on('close', async (code) => {
        if (code !== 0) {
          console.error('[Extractor] Failed:', extractorErr);
          // Resolve with what we have, but note failure
          return resolve({ rawId: rawDoc._id, cleanId: cleanDoc._id, curatedId: null, error: 'Extraction failed' });
        }

        let parsed;
        try {
          parsed = JSON.parse(extractorOut);
          console.log('[Extractor] Parsed JSON:', parsed);
        } catch (e) {
          console.error('[Extractor] JSON parse error:', e.message);
          console.error('[Extractor] Raw output was:', extractorOut);
          return resolve({ rawId: rawDoc._id, cleanId: cleanDoc._id, curatedId: null, error: 'JSON parse failed' });
        }

        // Extract amounts from montants array
        let montantHT = null;
        let montantTTC = null;
        let tvaVal = null;

        if (parsed.montants && Array.isArray(parsed.montants)) {
          for (const m of parsed.montants) {
            const label = (m.label || '').toLowerCase();
            const rawMontant = (m.montant !== undefined && m.montant !== null) ? String(m.montant).trim() : '';
            const value = parseAmountString(rawMontant);
            if (value == null) continue;

            if (label.includes('ht') || label.includes('montant ht')) {
              montantHT = value;
            } else if (label.includes('ttc') || label.includes('total ttc') || label.includes('montant ttc')) {
              montantTTC = value;
            } else if (label.includes('tva')) {
              tvaVal = value;
            }
          }
        }

        // Handle SIRET as array (take first one as supplier SIRET)
        let siretValue = null;
        if (Array.isArray(parsed.siret) && parsed.siret.length > 0) {
          siretValue = parsed.siret[0];
        } else if (typeof parsed.siret === 'string') {
          siretValue = parsed.siret;
        }

        // Get company names from societes array
        let entrepriseName = null;
        let clientName = null;
        if (Array.isArray(parsed.societes) && parsed.societes.length > 0) {
          entrepriseName = parsed.societes[0];
          clientName = parsed.societes.length > 1 ? parsed.societes[1] : null;
        }

        // Extract dates from dates array
        let dateEmission = null;
        let dateEcheance = null;
        if (Array.isArray(parsed.dates) && parsed.dates.length > 0) {
          for (const d of parsed.dates) {
            const label = (d.label || '').toLowerCase();
            if (label.includes('emission') && !dateEmission) {
              dateEmission = parseDateString(d.date);
            } else if ((label.includes('echeance') || label.includes('échéance')) && !dateEcheance) {
              dateEcheance = parseDateString(d.date);
            }
          }
        }

        const curated = new CuratedDocument({
          rawId: rawDoc._id,
          enterpriseId: user?.enterpriseId,
          cleanId: cleanDoc._id,
          documentType: docType,
          siret: siretValue,
          MyEntreprise: entrepriseName,
          client: clientName,
          address: parsed.address,
          tva: tvaVal,
          montantHT: montantHT,
          montantTTC: montantTTC,
          dateEmission: dateEmission,
          dateEcheance: dateEcheance,
          modePaiement: parsed.mode_paiement,
          status: 'needs_validation',
        });

        const savedCuratedDoc = await curated.save();

        rawDoc.status = 'processed';
        await rawDoc.save();
        cleanDoc.status = 'processed';
        await cleanDoc.save();

        console.log('[Curator] Successfully created curated document', savedCuratedDoc._id);
        
        resolve({
          rawId: rawDoc._id,
          cleanId: cleanDoc._id,
          curatedId: savedCuratedDoc._id
        });
      });

      extractorProc.stdin.write(ocrText);
      extractorProc.stdin.end();

    } catch (error) {
      console.error('Error in uploadFile promise:', error);
      reject(error);
    }
  });
}

async function getDocumentsForUser(user) {
  if (!user || !user.enterpriseId) {
    return [];
  }
  // For now, returns all documents for the enterprise.
  // Later, this could be filtered by user permissions.
  return CuratedDocument.find({ enterpriseId: user.enterpriseId }).sort({ createdDate: -1 });
}

async function getDocumentById(docId, user) {
  const doc = await CuratedDocument.findById(docId);
  if (!doc) return null;
  // Security check: ensure user belongs to the same enterprise
  if (doc.enterpriseId.toString() !== user.enterpriseId.toString()) {
    return null;
  }
  return doc;
}

async function updateDocument(docId, updates, user) {
  const doc = await CuratedDocument.findById(docId);
  if (!doc) throw new Error('Document not found');

  // Security check
  if (doc.enterpriseId.toString() !== user.enterpriseId.toString()) {
    throw new Error('Unauthorized');
  }

  // Example of updatable fields
  const allowedUpdates = [
    'data.fournisseur', 'data.montantHT', 'data.montantTTC', 'data.TVA',
    'data.dateEmission', 'data.dateEcheance', 'data.moyenPaiement',
    'data.categorie', 'data.numeroFacture', 'status'
  ];

  let hasChanges = false;
  for (const key in updates) {
    // Use a helper to set nested properties e.g., 'data.fournisseur'
    const keys = key.split('.');
    let current = doc;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
      if (current === undefined) break;
    }
    if (current && current[keys[keys.length - 1]] !== undefined) {
      if (allowedUpdates.includes(key)) {
        current[keys[keys.length - 1]] = updates[key];
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    doc.lastModified = new Date();
    // If status is changed to 'validated', record who and when
    if (updates.status === 'validated' && doc.status !== 'validated') {
      doc.status = 'validated';
      doc.validationDate = new Date();
      doc.validatedBy = user.id;
      doc.validatedBySnapshot = { username: user.username, fullName: user.fullName };
    }
    await doc.save();
  }

  return doc;
}

function getDownloadStreamById(fileId) {
  const db = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'rawFiles' });
  const _id = new mongoose.Types.ObjectId(fileId);
  return bucket.openDownloadStream(_id);
}

async function reprocessRaw(rawId, user) {
  const raw = await RawDocument.findById(rawId);
  if (!raw) throw new Error('RawDocument not found');
  if (!raw.fileUrl) throw new Error('No file reference in RawDocument');

  const db = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'rawFiles' });
  const fileObjectId = new mongoose.Types.ObjectId(raw.fileUrl);
  const downloadStream = bucket.openDownloadStream(fileObjectId);

  const chunks = [];
  downloadStream.on('data', (c) => chunks.push(c));

  await new Promise((resolve, reject) => {
    downloadStream.on('error', (err) => reject(err));
    downloadStream.on('end', () => resolve());
  });

  const buffer = Buffer.concat(chunks);
  const mimetype = raw.metadata?.mimetype || '';
  const ocrText = await performOcrOnBuffer(buffer, mimetype, raw.filename);

  const cleanDoc = await CleanDocument.findOneAndUpdate(
    { rawId: raw._id },
    { rawId: raw._id, ocrText, jsonExtracted: {}, extractionDate: new Date(), status: 'processed', enterpriseId: user?.enterpriseId },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  raw.processingHistory = raw.processingHistory || [];
  raw.processingHistory.push({ step: 'ocr_reprocess', status: 'processed', ts: new Date() });
  await raw.save();

  return { cleanId: cleanDoc._id, ocrLength: (cleanDoc.ocrText || '').length, snippet: (cleanDoc.ocrText || '').slice(0, 200) };
}

module.exports = {
  uploadFile,
  getDocumentsForUser,
  getDocumentById,
  updateDocument,
  performOcrOnBuffer,
  uploadBufferToGridFS,
  getDownloadStreamById,
  reprocessRaw
};
