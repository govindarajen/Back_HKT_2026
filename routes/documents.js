const express = require('express');
const multer = require('multer');
const checkAuthentication = require('../generics/checkAuthentication');
const documentsService = require('../services/documentsService');
const RawDocument = require('../models/RawDocument');
const CleanDocument = require('../models/CleanDocument');
const CuratedDocument = require('../models/CuratedDocument');
const Enterprise = require('../models/enterprise');
const User = require('../models/user');

const router = express.Router();
const storage = multer.memoryStorage();
// allow multiple file fields from the front (e.g. key 'file' per foreach or 'files' array)
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024, files: 10 } }); // 50MB per file, max 10 files

// POST /upload 
router.post('/upload', checkAuthentication, upload.any(), async (req, res) => {
  try {
    
    const files = (req.files && req.files.length) ? req.files : [];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const results = [];
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
// GET /raw/:id - stream file for preview or download
router.get('/raw/:id', checkAuthentication, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Find the document metadata to get filename and mimetype
    const doc = await RawDocument.findById(id);
    if (!doc) return res.status(404).json({ error: 'File not found' });

    // Check if fileUrl exists (GridFS file reference)
    if (!doc.fileUrl) {
      return res.status(404).json({ error: 'File reference not found' });
    }

    // Set headers for preview or download
    const disposition = req.query.download === 'true'
      ? `attachment; filename="${doc.filename || 'file'}"`
      : `inline; filename="${doc.filename || 'file'}"`;

    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Type', doc.metadata?.mimetype || doc.mimetype || 'application/octet-stream');

    try {
      // Pass fileUrl (GridFS file ID) instead of document ID
      const downloadStream = documentsService.getDownloadStreamById(doc.fileUrl);
      
      downloadStream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream file' });
        }
      });

      downloadStream.on('end', () => {
        res.end();
      });

      downloadStream.pipe(res);
    } catch (streamErr) {
      console.error('Stream creation error:', streamErr);
      return res.status(404).json({ error: 'File not found in storage' });
    }
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
  const isAdmin = res.locals.user?.groupId?.rights?.includes('*');

  const enterpriseId = !isAdmin ? res.locals.user.enterpriseId : 0;

  const find = isAdmin ? {} : { enterpriseId: enterpriseId }; // Admins see all, others see only their uploads
  if (!enterpriseId) {
    return res.json({
      success: true,
      data: []
    });
  }

  try {
    const docs = await RawDocument.find(find).sort({ uploadDate: -1 }).limit(100);
    return res.json(docs);
  } catch (err) {
    console.error('list raw docs error', err);
    return res.status(500).json({ error: 'Failed to list raw documents' });
  }
});

// GET /clean - list all clean documents
router.get('/clean', checkAuthentication, async (req, res) => {
  const isAdmin = res.locals.user?.groupId?.rights?.includes('*');

  const enterpriseId = !isAdmin ? res.locals.user.enterpriseId : 0;

  const find = isAdmin ? {} : { enterpriseId: enterpriseId }; // Admins see all, others see only their uploads
  if (!enterpriseId) {
    return res.json({
      success: true,
      data: []
    });
  }

  try {
    const docs = await CleanDocument.find(find)
    .populate('rawId', 'filename type uploadDate')
    .sort({ extractionDate: -1 }).limit(100);
    return res.json(docs);
  } catch (err) {
    console.error('list clean docs error', err);
    return res.status(500).json({ error: 'Failed to list clean documents' });
  }
});

// GET /curated - list all curated documents
router.get('/curated', checkAuthentication, async (req, res) => {
  const isAdmin = res.locals.user?.groupId?.rights?.includes('*');

  const enterpriseId = !isAdmin ? res.locals.user.enterpriseId : 0;

  const find = isAdmin ? {} : { enterpriseId: enterpriseId }; // Admins see all, others see only their uploads
  if (!enterpriseId) {
    return res.json({
      success: true,
      data: []
    });
  }
  try {
    const docs = await CuratedDocument.find(find).populate('rawId').sort({ validationDate: -1 }).limit(100);
    console.log('Curated documents found:', docs.length);
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

router.patch('/:docType/:id/status', checkAuthentication, async (req, res) => {
  try {
    const { docType, id } = req.params;
    const { status } = req.body;
    const requesterId = res.locals?.user?.id;

    const allowedStatuses = ['queued', 'processing', 'processed', 'needs_validation', 'validated', 'rejected'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const modelMap = {
      raw: RawDocument,
      clean: CleanDocument,
      curated: CuratedDocument,
    };

    const Model = modelMap[docType];
    if (!Model) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const document = await Model.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let enterpriseId = document.enterpriseId || null;

    if (docType === 'curated') {
      if (!document.cleanId) {
        return res.status(400).json({ error: 'Curated document is not linked to a clean document' });
      }

      const cleanDocument = await CleanDocument.findById(document.cleanId).select('enterpriseId');
      enterpriseId = cleanDocument?.enterpriseId || null;
    }

    if (docType === 'raw') {
      if (!document.uploadedBy) {
        return res.status(400).json({ error: 'Raw document has no uploader reference' });
      }

      const uploader = await User.findById(document.uploadedBy).select('enterpriseId');
      enterpriseId = uploader?.enterpriseId || null;
    }

    if (!enterpriseId) {
      return res.status(400).json({ error: 'No enterprise linked to this document' });
    }

    const enterprise = await Enterprise.findById(enterpriseId).select('ownerId');
    if (!enterprise) {
      return res.status(404).json({ error: 'Enterprise not found' });
    }

    if (String(enterprise.ownerId) !== String(requesterId)) {
      return res.status(403).json({ error: 'Only the enterprise owner can update status' });
    }

    document.status = status;
    document.processingHistory = document.processingHistory || [];
    document.processingHistory.push({ step: 'manual_status_update', status, ts: new Date() });

    if (docType === 'curated') {
      if (status === 'validated') {
        document.validated = true;
        document.validationDate = new Date();
      }
      if (status === 'rejected') {
        document.validated = false;
      }
    }

    await document.save();

    return res.status(200).json({ result: true, document });
  } catch (err) {
    console.error('update status route error', err);
    return res.status(500).json({ error: 'Failed to update document status' });
  }
});

module.exports = router;
