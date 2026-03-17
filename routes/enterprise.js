var express = require('express');
const checkAuthentication = require('../generics/checkAuthentication.js');
const enterpriseService = require('../services/enterpriseService.js');
var router = express.Router();

router.post('/', [checkAuthentication, enterpriseService.createEnterprise]);
router.put('/:id', [checkAuthentication, enterpriseService.updateEnterprise]);
router.get('/all', [checkAuthentication, enterpriseService.getAllEnterprises]);
router.get('/:id', [checkAuthentication, enterpriseService.getById]);
router.delete('/:id', [checkAuthentication, enterpriseService.deleteEnterprise]);

module.exports = router;
