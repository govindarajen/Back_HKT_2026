const mongoose = require('mongoose');

const RawDocumentSchema = new mongoose.Schema({
  filename: String,
  type: { 
    type: String,
    enum: ['facture_fournisseur','devis','attestation_siret','attestation_urssaf','extrait_kbis','rib','autre'],
    default: 'autre'
  },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', index: true }, 
  uploadedBySnapshot: {
    username: String,
    fullName: String
  },
  // raw extracted address text (optional)
  extractedAddress: String,
  uploadDate: { type: Date, default: Date.now },
  fileUrl: String, // lien vers le PDF / image sur Atlas 
  metadata: Object,
  // Processing status for pipeline orchestration
  status: {
    type: String,
    enum: ['queued','processing','processed','needs_validation','validated','rejected'],
    default: 'queued',
    index: true
  },
  processingHistory: [{ step: String, status: String, workerId: String, message: String, ts: { type: Date, default: Date.now } }],
});

module.exports = mongoose.model('RawDocument', RawDocumentSchema);
