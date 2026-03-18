const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');
const checkAuthentication = require('../generics/checkAuthentication');

/**
 * GET /api/dashboard/stats
 * Get global dashboard statistics
 */
router.get('/stats', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    
    const stats = await dashboardService.getGlobalStats(enterpriseId);
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/anomalies/severity
 * Get anomalies grouped by severity
 */
router.get('/anomalies/severity', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    
    const data = await dashboardService.getAnomaliesBySeverity(enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /anomalies/severity:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/anomalies/top
 * Get top anomalies by type
 * Query params: limit (default: 10)
 */
router.get('/anomalies/top', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    const limit = req.query.limit || 10;
    
    const data = await dashboardService.getTopAnomalies(limit, enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /anomalies/top:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/documents/by-type
 * Get documents grouped by type
 */
router.get('/documents/by-type', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    
    const data = await dashboardService.getDocumentsByType(enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /documents/by-type:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/anomalies/by-document-type
 * Get anomalies rate by document type
 */
router.get('/anomalies/by-document-type', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    
    const data = await dashboardService.getAnomaliesRateByDocType(enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /anomalies/by-document-type:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/suppliers/at-risk
 * Get suppliers with most anomalies
 * Query params: limit (default: 10)
 */
router.get('/suppliers/at-risk', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    const limit = req.query.limit || 10;
    
    const data = await dashboardService.getSuppliersAtRisk(limit, enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /suppliers/at-risk:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/validation/status
 * Get validation status
 */
router.get('/validation/status', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    
    const data = await dashboardService.getValidationStatus(enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /validation/status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/dashboard/processing/status
 * Get document processing status
 */
router.get('/processing/status', checkAuthentication, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.groupId?.rights?.includes('*');
    const enterpriseId = isAdmin ? null : res.locals.user?.enterpriseId;
    
    const data = await dashboardService.getProcessingStatus(enterpriseId);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[DashboardRoute] Error in /processing/status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
