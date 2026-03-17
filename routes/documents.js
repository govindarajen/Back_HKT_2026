const express = require('express');
const multer = require('multer');
const checkAuthentication = require('../generics/checkAuthentication');
const documentsService = require('../services/documentsService');
const RawDocument = require('../models/RawDocument');
const CleanDocument = require('../models/CleanDocument');
const CuratedDocument = require('../models/CuratedDocument');

const router = express.Router();
const storage = multer.memoryStorage();
// allow multiple file fields from the front (e.g. key 'file' per foreach or 'files' array)
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024, files: 10 } }); // 50MB per file, max 10 files

// POST /upload - accept files from any form key (support front sending files one-by-one or as an array)
router.post('/upload', checkAuthentication, upload.any(), async (req, res) => {
  try {
    // multer.any() populates req.files as an array for any field name
    const files = (req.files && req.files.length) ? req.files : [];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const results = [];
    // Process files sequentially to avoid saturating CPU/memory; could be parallel with throttling
    for (const file of files) {
      const result = await documentsService.uploadFile({ file, body: req.body, user: res.locals.user });
      results.push(result);
    }

    return res.json({ results });
  } catch (err) {
    console.error('upload route error', err);
    return res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

// GET /raw/:id - stream file from GridFS
router.get('/raw/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const downloadStream = documentsService.getDownloadStreamById(id);
    downloadStream.on('error', (err) => {
      res.status(404).json({ error: 'File not found' });
    });
    downloadStream.pipe(res);
  } catch (err) {
    console.error('stream route error', err);
    res.status(500).json({ error: 'Failed to stream file' });
  }
});

// POST /reprocess/:rawId - re-run OCR for an existing raw document
router.post('/reprocess/:rawId', checkAuthentication, async (req, res) => {
  try {
    const rawId = req.params.rawId;
    const result = await documentsService.reprocessRaw(rawId, res.locals.user);
    return res.json(result);
  } catch (err) {
    console.error('reprocess route error', err);
    return res.status(500).json({ error: 'Reprocess failed', details: err.message });
  }
});

// GET /raw - list all raw documents
router.get('/raw', checkAuthentication, async (req, res) => {
  try {
    const docs = await RawDocument.find().sort({ uploadDate: -1 }).limit(100);
    return res.json(docs);
  } catch (err) {
    console.error('list raw docs error', err);
    return res.status(500).json({ error: 'Failed to list raw documents' });
  }
});

// GET /clean - list all clean documents
router.get('/clean', checkAuthentication, async (req, res) => {
  try {
    const docs = await CleanDocument.find().sort({ extractionDate: -1 }).limit(100);
    return res.json(docs);
  } catch (err) {
    console.error('list clean docs error', err);
    return res.status(500).json({ error: 'Failed to list clean documents' });
  }
});

// GET /curated - list all curated documents
router.get('/curated', checkAuthentication, async (req, res) => {
  try {
    const docs = await CuratedDocument.find().sort({ validationDate: -1 }).limit(100);
    return res.json(docs);
  } catch (err) {
    console.error('list curated docs error', err);
    return res.status(500).json({ error: 'Failed to list curated documents' });
  }
});

// GET /clean/:id - get clean document by id
router.get('/clean/:id', checkAuthentication, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const doc = await CleanDocument.findById(id).populate('rawId');
    if (!doc) return res.status(404).json({ error: 'CleanDocument not found' });
    return res.json(doc);
  } catch (err) {
    console.error('get clean doc error', err);
    return res.status(500).json({ error: 'Failed to get clean document' });
  }
});

// GET /curated/:id - get curated document by id
router.get('/curated/:id', checkAuthentication, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const doc = await CuratedDocument.findById(id).populate('rawId cleanId');
    if (!doc) return res.status(404).json({ error: 'CuratedDocument not found' });
    return res.json(doc);
  } catch (err) {
    console.error('get curated doc error', err);
    return res.status(500).json({ error: 'Failed to get curated document' });
  }
});

module.exports = router;
