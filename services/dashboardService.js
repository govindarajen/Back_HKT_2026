const CuratedDocument = require('../models/CuratedDocument');

/**
 * Get global dashboard statistics
 */
async function getGlobalStats(enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const total = await CuratedDocument.countDocuments(matchStage);
    const withAnomalies = await CuratedDocument.countDocuments({ ...matchStage, 'anomalies.0': { $exists: true } });
    
    // Count total anomalies using JavaScript instead of aggregation
    const documents = await CuratedDocument.find(matchStage).lean();
    
    let totalAnomalies = 0;
    documents.forEach(doc => {
      if (Array.isArray(doc.anomalies)) {
        totalAnomalies += doc.anomalies.length;
      }
    });

    const conformityRate = total > 0 ? Math.round(((total - withAnomalies) / total) * 100) : 0;
    const anomaliesRate = total > 0 ? Math.round((withAnomalies / total) * 100) : 0;

    return {
      totalDocuments: total,
      documentsWithAnomalies: withAnomalies,
      documentsWithoutAnomalies: total - withAnomalies,
      conformityRate: conformityRate,
      anomaliesRate: anomaliesRate,
      totalAnomalies: totalAnomalies
    };
  } catch (error) {
    console.error('[DashboardService] Error in getGlobalStats:', error);
    throw error;
  }
}

/**
 * Get anomalies grouped by severity
 */
async function getAnomaliesBySeverity(enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    // Use lean() to get plain JavaScript objects
    const documents = await CuratedDocument.find(matchStage).lean();

    console.log(`[DashboardService] Found ${documents.length} documents`);
    
    // Count anomalies by severity using JavaScript instead of aggregation
    const counts = {
      CRITIQUE: 0,
      AVERTISSEMENT: 0,
      INFO: 0
    };

    documents.forEach(doc => {
      if (Array.isArray(doc.anomalies)) {
        doc.anomalies.forEach(anomaly => {
          if (anomaly.severity === 'CRITIQUE') {
            counts.CRITIQUE++;
          } else if (anomaly.severity === 'AVERTISSEMENT') {
            counts.AVERTISSEMENT++;
          } else if (anomaly.severity === 'INFO') {
            counts.INFO++;
          }
        });
      }
    });

    console.log('[DashboardService] Anomalies counts:', counts);

    return counts;
  } catch (error) {
    console.error('[DashboardService] Error in getAnomaliesBySeverity:', error);
    throw error;
  }
}

/**
 * Get top anomalies by type
 */
async function getTopAnomalies(limit = 10, enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const documents = await CuratedDocument.find(matchStage).lean();
    
    // Count anomalies by type using JavaScript
    const anomalyTypeCounts = {};
    documents.forEach(doc => {
      if (Array.isArray(doc.anomalies)) {
        doc.anomalies.forEach(anomaly => {
          const type = anomaly.type;
          anomalyTypeCounts[type] = (anomalyTypeCounts[type] || 0) + 1;
        });
      }
    });

    // Sort and limit
    const result = Object.entries(anomalyTypeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, parseInt(limit));

    return result;
  } catch (error) {
    console.error('[DashboardService] Error in getTopAnomalies:', error);
    throw error;
  }
}

/**
 * Get documents grouped by type
 */
async function getDocumentsByType(enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const documents = await CuratedDocument.find(matchStage).lean();
    
    // Count documents by type
    const typeCounts = {};
    documents.forEach(doc => {
      const docType = doc.detectedType || 'inconnu';
      typeCounts[docType] = (typeCounts[docType] || 0) + 1;
    });

    return typeCounts;
  } catch (error) {
    console.error('[DashboardService] Error in getDocumentsByType:', error);
    throw error;
  }
}

/**
 * Get anomalies rate by document type
 */
async function getAnomaliesRateByDocType(enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const documents = await CuratedDocument.find(matchStage).lean();
    
    // Calculate stats by document type
    const docTypeStats = {};
    documents.forEach(doc => {
      const docType = doc.detectedType || 'inconnu';
      if (!docTypeStats[docType]) {
        docTypeStats[docType] = { total: 0, withAnomalies: 0 };
      }
      docTypeStats[docType].total++;
      if (Array.isArray(doc.anomalies) && doc.anomalies.length > 0) {
        docTypeStats[docType].withAnomalies++;
      }
    });

    // Calculate rates and format
    const result = Object.entries(docTypeStats)
      .map(([docType, stats]) => ({
        docType: docType,
        total: stats.total,
        withAnomalies: stats.withAnomalies,
        rate: stats.total > 0 ? Math.round((stats.withAnomalies / stats.total) * 100) : 0
      }))
      .sort((a, b) => b.rate - a.rate);

    return result;
  } catch (error) {
    console.error('[DashboardService] Error in getAnomaliesRateByDocType:', error);
    throw error;
  }
}

/**
 * Get suppliers at risk (with most anomalies)
 */
async function getSuppliersAtRisk(limit = 10, enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const documents = await CuratedDocument.find(matchStage).lean();
    
    // Group by SIRET and count anomalies
    const supplierStats = {};
    documents.forEach(doc => {
      if (Array.isArray(doc.anomalies) && doc.anomalies.length > 0) {
        const siret = doc.siret || 'unknown';
        if (!supplierStats[siret]) {
          supplierStats[siret] = {
            siret: siret,
            name: doc.client || doc.MyEntreprise || 'Unknown',
            anomaliesCount: 0,
            docCount: 0
          };
        }
        supplierStats[siret].anomaliesCount += doc.anomalies.length;
        supplierStats[siret].docCount++;
      }
    });

    // Convert to array, calculate rate, sort and limit
    const result = Object.values(supplierStats)
      .map(supplier => ({
        siret: supplier.siret,
        name: supplier.name,
        anomaliesCount: supplier.anomaliesCount,
        docCount: supplier.docCount,
        rate: supplier.docCount > 0 ? Math.round((supplier.anomaliesCount / supplier.docCount) * 100) : 0
      }))
      .sort((a, b) => b.anomaliesCount - a.anomaliesCount)
      .slice(0, parseInt(limit));

    return result;
  } catch (error) {
    console.error('[DashboardService] Error in getSuppliersAtRisk:', error);
    throw error;
  }
}

/**
 * Get validation status
 */
async function getValidationStatus(enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const documents = await CuratedDocument.find(matchStage).lean();
    
    const formatted = {
      valid: 0,
      invalid: 0,
      pending: 0
    };

    documents.forEach(doc => {
      const status = doc.validationStatus || 'pending';
      if (formatted.hasOwnProperty(status)) {
        formatted[status]++;
      }
    });

    return formatted;
  } catch (error) {
    console.error('[DashboardService] Error in getValidationStatus:', error);
    throw error;
  }
}

/**
 * Get document processing status
 */
async function getProcessingStatus(enterpriseId = null) {
  try {
    const matchStage = enterpriseId ? { enterpriseId: enterpriseId } : {};
    
    const documents = await CuratedDocument.find(matchStage).lean();
    
    const formatted = {
      queued: 0,
      processing: 0,
      processed: 0,
      needs_validation: 0,
      validated: 0,
      rejected: 0
    };

    documents.forEach(doc => {
      const status = doc.status || 'queued';
      if (formatted.hasOwnProperty(status)) {
        formatted[status]++;
      }
    });

    return formatted;
  } catch (error) {
    console.error('[DashboardService] Error in getProcessingStatus:', error);
    throw error;
  }
}

module.exports = {
  getGlobalStats,
  getAnomaliesBySeverity,
  getTopAnomalies,
  getDocumentsByType,
  getAnomaliesRateByDocType,
  getSuppliersAtRisk,
  getValidationStatus,
  getProcessingStatus
};
