const express = require('express');
const multer = require('multer');
const checkAuthentication = require('../generics/checkAuthentication');
const documentsService = require('../services/documentsService');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// POST /upload
router.post('/upload', checkAuthentication, upload.single('file'), async (req, res) => {
  try {
    const result = await documentsService.uploadFile({ file: req.file, body: req.body, user: res.locals.user });
    return res.json(result);
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
    const result = await documentsService.reprocessRaw(rawId);
    return res.json(result);
  } catch (err) {
    console.error('reprocess route error', err);
    return res.status(500).json({ error: 'Reprocess failed', details: err.message });
  }
});

module.exports = router;
