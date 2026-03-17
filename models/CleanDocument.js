const mongoose = require('mongoose');

const CleanDocumentSchema = new mongoose.Schema({
  rawId: { type: mongoose.Schema.Types.ObjectId, ref: 'RawDocument' },
  ocrText: String, // texte complet OCR
  jsonExtracted: Object, // JSON brut après extraction
  extractionDate: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['queued','processing','processed','needs_validation','validated','rejected'],
    default: 'queued',
    index: true
  },
  enterpriseId: { type: mongoose.Schema.Types.ObjectId, ref: 'enterprises', index: true },
  processingHistory: [{ step: String, status: String, workerId: String, message: String, ts: { type: Date, default: Date.now } }]
});

module.exports = mongoose.model('CleanDocument', CleanDocumentSchema);
