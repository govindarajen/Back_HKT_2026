var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.send('API v0.0.1 | Alpha');
});

module.exports = router;
