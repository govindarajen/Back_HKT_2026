const mongoose = require('mongoose');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');

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

async function performOcrOnBuffer(buffer, mimetype) {
  let ocrText = '';

  if (mimetype === 'application/pdf') {
    try {
      const data = await pdfParse(buffer);
      ocrText = data.text || '';
    } catch (err) {
      // pdf-parse failed
      console.error('pdf-parse error', err);
      ocrText = '';
    }

    if (!ocrText || ocrText.trim().length === 0) {
      // fallback to tesseract on PDF buffer
      const worker = createWorker();
      try {
        await worker.load();
        try { await worker.loadLanguage('fra'); await worker.initialize('fra'); } catch (e) { try { await worker.loadLanguage('eng'); await worker.initialize('eng'); } catch(e){} }
        const { data } = await worker.recognize(buffer);
        ocrText = data?.text || '';
      } catch (err) {
        console.error('tesseract fallback error on pdf buffer', err);
      } finally {
        try { await worker.terminate(); } catch (e) {}
      }
    }
  } else if (mimetype.startsWith('image/')) {
    const worker = createWorker();
    try {
      await worker.load();
      try { await worker.loadLanguage('fra'); await worker.initialize('fra'); } catch (e) { try { await worker.loadLanguage('eng'); await worker.initialize('eng'); } catch(e){} }
      const { data } = await worker.recognize(buffer);
      ocrText = data?.text || '';
    } catch (err) {
      console.error('tesseract error', err);
    } finally {
      try { await worker.terminate(); } catch (e) {}
    }
  } else {
    // unknown mimetype: try pdf-parse then tesseract
    try {
      const data = await pdfParse(buffer);
      ocrText = data.text || '';
    } catch (e) {
      console.error('pdf-parse error (unknown mimetype)', e);
      ocrText = '';
    }

    if (!ocrText || ocrText.trim().length === 0) {
      const worker = createWorker();
      try {
        await worker.load();
        try { await worker.loadLanguage('fra'); await worker.initialize('fra'); } catch (e) { try { await worker.loadLanguage('eng'); await worker.initialize('eng'); } catch(e){} }
        const { data } = await worker.recognize(buffer);
        ocrText = data?.text || '';
      } catch (err) {
        console.error('tesseract fallback error (unknown mimetype)', err);
      } finally {
        try { await worker.terminate(); } catch (e) {}
      }
    }
  }

  return ocrText;
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
    status: 'queued'
  });

  await rawDoc.save();

  const ocrText = await performOcrOnBuffer(file.buffer, file.mimetype);

  const cleanDoc = new CleanDocument({ rawId: rawDoc._id, ocrText, jsonExtracted: {}, extractionDate: new Date(), status: 'processed', enterpriseId: res.locals.user.enterpriseId });
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

async function reprocessRaw(rawId) {
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
  const ocrText = await performOcrOnBuffer(buffer, mimetype);

  const cleanDoc = await CleanDocument.findOneAndUpdate(
    { rawId: raw._id },
    { rawId: raw._id, ocrText, jsonExtracted: {}, extractionDate: new Date(), status: 'processed', enterpriseId: res.locals.user.enterpriseId },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  raw.processingHistory = raw.processingHistory || [];
  raw.processingHistory.push({ step: 'ocr_reprocess', status: 'processed', ts: new Date() });
  await raw.save();

  return { cleanId: cleanDoc._id, ocrLength: (cleanDoc.ocrText || '').length, snippet: (cleanDoc.ocrText || '').slice(0, 200) };
}

module.exports = { uploadFile, getDownloadStreamById, reprocessRaw };
