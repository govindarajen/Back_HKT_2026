const mongoose = require('mongoose');


const CuratedDocumentSchema = new mongoose.Schema({
  rawId: { type: mongoose.Schema.Types.ObjectId, ref: 'RawDocument' },
  cleanId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleanDocument' },
  documentType: {
    type: String,
    enum: ['facture_fournisseur','devis','attestation_siret','attestation_urssaf','extrait_kbis','rib','autre'],
    default: 'autre'
  },
  siret: String,
  MyEntreprise: String,
  client: String,
  // structured address for the company/supplier
  address: {
    full: String, // full raw address line
    street: String,
    postalCode: String,
    city: String,
    country: String
  },
  tva: Number,
  montantHT: Number,
  montantTTC: Number,
  dateEmission: Date,
  dateEcheance: Date, // date d'échéance / échéance de paiement
  dateExpiration: Date, // pour attestation
  modePaiement: String, // ex: 'Virement', 'CB', 'Chèque'
  anomalies: [String], // ex: "TVA incohérente", "SIRET différent"
  validated: { type: Boolean, default: false },
  validationDate: Date
  ,
  status: {
    type: String,
    enum: ['queued','processing','processed','needs_validation','validated','rejected'],
    default: 'queued',
    index: true
  },
  processingHistory: [{ step: String, status: String, workerId: String, message: String, ts: { type: Date, default: Date.now } }]
});

module.exports = mongoose.model('CuratedDocument', CuratedDocumentSchema);
