const mongoose = require('mongoose');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const RawDocument = require('../models/RawDocument');
const CleanDocument = require('../models/CleanDocument');

async function uploadBufferToGridFS(filename, buffer, contentType, metadata = {}) {
  const db = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'rawFiles' });
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { metadata: { contentType, ...metadata } });
    uploadStream.end(buffer, (err) => {
      if (err) return reject(err);
      resolve(uploadStream.id);
    });
  });
}

async function performOcrOnBuffer(buffer, mimetype, filename = 'document') {
  // Utilise le script Python test_fct.py pour faire l'OCR
  
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `ocr_${Date.now()}_${filename}`);
    const outputFile = path.join(tempDir, `ocr_result_${Date.now()}.txt`);
    
      try {
        // Écrit le buffer dans un fichier temporaire
        fs.writeFileSync(tempFile, buffer);
      
      // Appelle le script Python avec l'option --save pour récupérer le texte dans un fichier
      const scriptPath = path.join(__dirname, '../scripts/test_fct.py');
      // Ensure the spawned Python process can find Poppler (pdftoppm/pdfinfo)
      // and Tesseract data even if the Node process PATH isn't set system-wide.
  const env = Object.assign({}, process.env);

      // Helper: check if pdfinfo is already available in PATH (where on Windows)
      let popplerAvailable = false;
      try {
        const whereRes = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pdfinfo'], { encoding: 'utf8' });
        if (whereRes.status === 0 && whereRes.stdout && whereRes.stdout.trim().length > 0) {
          popplerAvailable = true;
        }
      } catch (e) {
        // ignore
      }

      // Candidate locations to check for Poppler binaries (Windows typical installs)
      const candidatePopplerDirs = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'poppler', 'bin'),
        'C:\\poppler\\poppler-24.02.0\\Library\\bin',
        path.join(require('os').homedir(), 'scoop', 'shims'),
      ];

      let popplerBinToAdd = null;
      if (!popplerAvailable) {
        for (const cand of candidatePopplerDirs) {
          try {
            if (fs.existsSync(path.join(cand, process.platform === 'win32' ? 'pdfinfo.exe' : 'pdfinfo'))) {
              popplerBinToAdd = cand;
              break;
            }
          } catch (e) {}
        }
      }

      if (popplerBinToAdd) {
        if (!env.PATH || env.PATH.indexOf(popplerBinToAdd) === -1) {
          env.PATH = (env.PATH ? env.PATH + path.delimiter : '') + popplerBinToAdd;
        }
      }

      // Optional: ensure TESSDATA_PREFIX is set for Tesseract (safe even if Python also sets it)
      env.TESSDATA_PREFIX = env.TESSDATA_PREFIX || 'C:\\Program Files\\Tesseract-OCR\\tessdata';

  // Find a python executable: prefer local venv, otherwise try system 'python' or 'py'
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
  if (!file) throw new Error('No file provided');

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

  const cleanDoc = new CleanDocument({ rawId: rawDoc._id, ocrText, jsonExtracted: {}, extractionDate: new Date(), status: 'processed', enterpriseId: user?.enterpriseId });
  await cleanDoc.save();

  rawDoc.status = 'processed';
  rawDoc.processingHistory = rawDoc.processingHistory || [];
  rawDoc.processingHistory.push({ step: 'ocr', status: 'processed', ts: new Date() });
  await rawDoc.save();

  return { rawId: rawDoc._id, cleanId: cleanDoc._id };
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

module.exports = { uploadFile, getDownloadStreamById, reprocessRaw };
