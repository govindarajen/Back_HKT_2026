var express = require('express');
const checkAuthentication = require('../generics/checkAuthentication.js');
const membershipRequestService = require('../services/membershipRequestService.js');
var router = express.Router();

router.post('/', [checkAuthentication, membershipRequestService.createRequest]);
router.get('/my-pending', [checkAuthentication, membershipRequestService.getMyPendingRequests]);
router.post('/:id/respond', [checkAuthentication, membershipRequestService.respondToRequest]);

module.exports = router;
