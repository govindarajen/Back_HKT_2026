var express = require('express');
const checkAuthentication = require('../generics/checkAuthentication.js');
const userService = require('../services/userService.js');
var router = express.Router();

/* GET users listing. */
router.post('/login', [userService.login]);
router.post('/register', [userService.register]);
//router.post('/updateUser', [checkAuthentication, userService.updateUser]);
//router.post('/deleteUser', [checkAuthentication, userService.deleteUser]);
//router.get('/getUser', [checkAuthentication, userService.getUser]);
router.get('/getUserById', [checkAuthentication, userService.getUserById]);
router.get('/getUsers', [checkAuthentication, userService.getUsers]);
router.get('/', [checkAuthentication, userService.getUsers]);
router.post('/updateUserPref', [checkAuthentication, userService.updateUserPreferences]);
router.get('/getUsersPages', [userService.getUsersPages]);
router.put('/updateUser', [checkAuthentication, userService.updateUser]);

module.exports = router;
