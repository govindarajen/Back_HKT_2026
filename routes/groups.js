var express = require('express');
const checkAuthentication = require('../generics/checkAuthentication.js');
const groupsService = require('../services/groupsService.js');
var router = express.Router();

/* GET users listing. */
router.post('/', [checkAuthentication, groupsService.createGroup]);
router.put('/:id', [checkAuthentication, groupsService.updateGroup]);
router.get('/all', [checkAuthentication, groupsService.getAllGroups]);
router.get('/:id', [checkAuthentication, groupsService.getById]);
router.delete('/:id', [checkAuthentication, groupsService.deleteGroup]);

module.exports = router;
