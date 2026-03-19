// =============================================================================
// services/documentsService.js
// =============================================================================
// Rôle : Gère l'upload des documents et déclenche le pipeline Airflow.
//
// Changement par rapport à l'ancienne version :
//   AVANT : uploadFile() appelait directement les scripts Python (OCR, extraction)
//   APRÈS : uploadFile() sauvegarde le fichier et déclenche le DAG Airflow
//           C'est Airflow qui appelle les scripts Python dans le bon ordre.
// =============================================================================
 
const mongoose = require('mongoose');
const path = require('path');
 
const RawDocument = require('../models/RawDocument');
const CleanDocument = require('../models/CleanDocument');
const CuratedDocument = require('../models/CuratedDocument');
 
// URL de l'API Airflow — "airflow-webserver" = nom du service dans docker-compose
const AIRFLOW_URL = process.env.AIRFLOW_URL || 'http://airflow-webserver:8080';
const AIRFLOW_USER = process.env.AIRFLOW_USER || 'admin';
const AIRFLOW_PASSWORD = process.env.AIRFLOW_PASSWORD || 'admin';
 
// =============================================================================
// UPLOAD DANS GRIDFS
// =============================================================================
async function uploadBufferToGridFS(filename, buffer, contentType, metadata = {}) {
  const db = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'rawFiles' });
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: contentType,
      metadata: metadata
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}
 
// =============================================================================
// DÉCLENCHE LE DAG AIRFLOW
// Appelle l'API REST Airflow pour lancer pipeline_documents avec le rawId
// =============================================================================
async function triggerAirflowDAG(rawId) {
  const url = `${AIRFLOW_URL}/api/v1/dags/pipeline_documents/dagRuns`;
 
  const body = JSON.stringify({
    conf: { raw_id: rawId.toString() },  // passe le rawId au DAG
    dag_run_id: `upload_${rawId}_${Date.now()}`,  // ID unique pour chaque run
  });
 
  // Authentification Basic Airflow (admin/admin par défaut)
  const credentials = Buffer.from(`${AIRFLOW_USER}:${AIRFLOW_PASSWORD}`).toString('base64');
 
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
    },
    body,
  });
 
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airflow trigger failed (${response.status}): ${error}`);
  }
 
  const result = await response.json();
  console.log(`[Airflow] DAG déclenché — dag_run_id: ${result.dag_run_id}`);
  return result;
}
 
// =============================================================================
// UPLOAD FICHIER
// Sauvegarde le fichier et déclenche le DAG Airflow
// =============================================================================
async function uploadFile({ file, body, user }) {
  if (!file) throw new Error('No file provided');
 
  const docType = body?.type || 'autre';
 
  // 1. Sauvegarde le fichier dans GridFS
  const fileId = await uploadBufferToGridFS(
    file.originalname,
    file.buffer,
    file.mimetype,
    { uploadedBy: user?.id }
  );
 
  // 2. Crée le RawDocument avec statut "queued"
  const rawDoc = new RawDocument({
    filename:            file.originalname,
    type:                docType,
    uploadedBy:          user?.id,
    uploadedBySnapshot:  { username: user?.username || '', fullName: user?.fullName || '' },
    uploadDate:          new Date(),
    fileUrl:             fileId.toString(),
    metadata:            { originalname: file.originalname, mimetype: file.mimetype, size: file.size },
    enterpriseId:        user?.enterpriseId,
    status:              'queued',   // Airflow va le passer à "processing" puis "processed"
  });
  await rawDoc.save();
 
  console.log(`[Upload] RawDocument créé: ${rawDoc._id} — déclenchement du DAG Airflow...`);
 
  // 3. Déclenche le DAG Airflow en lui passant le rawId
  try {
    await triggerAirflowDAG(rawDoc._id);
    console.log(`[Upload] DAG déclenché pour rawId: ${rawDoc._id}`);
  } catch (err) {
    // Si Airflow est indisponible, on log l'erreur mais on ne bloque pas l'upload
    console.error(`[Upload] Impossible de déclencher le DAG: ${err.message}`);
    rawDoc.status = 'queued';
    await rawDoc.save();
  }
 
  // Retourne immédiatement — le traitement se fait en arrière-plan dans Airflow
  return { rawId: rawDoc._id };
}
 
// =============================================================================
// FONCTIONS DE LECTURE (inchangées)
// =============================================================================
async function getDocumentsForUser(user) {
  if (!user || !user.enterpriseId) return [];
  return CuratedDocument.find({ enterpriseId: user.enterpriseId }).sort({ createdDate: -1 });
}
 
async function getDocumentById(docId, user) {
  const doc = await CuratedDocument.findById(docId);
  if (!doc) return null;
  if (doc.enterpriseId.toString() !== user.enterpriseId.toString()) return null;
  return doc;
}
 
async function updateDocument(docId, updates, user) {
  const doc = await CuratedDocument.findById(docId);
  if (!doc) throw new Error('Document not found');
  if (doc.enterpriseId.toString() !== user.enterpriseId.toString()) throw new Error('Unauthorized');
 
  const allowedUpdates = [
    'data.fournisseur', 'data.montantHT', 'data.montantTTC', 'data.TVA',
    'data.dateEmission', 'data.dateEcheance', 'data.moyenPaiement',
    'data.categorie', 'data.numeroFacture', 'status'
  ];
 
  let hasChanges = false;
  for (const key in updates) {
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
 
  // Remet le statut à queued et redéclenche le DAG
  raw.status = 'queued';
  await raw.save();
 
  await triggerAirflowDAG(rawId);
  return { message: 'DAG redéclenché', rawId };
}
 
module.exports = {
  uploadFile,
  getDocumentsForUser,
  getDocumentById,
  updateDocument,
  getDownloadStreamById,
  reprocessRaw,
  uploadBufferToGridFS,
  triggerAirflowDAG,
};
