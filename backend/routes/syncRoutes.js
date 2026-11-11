const express = require('express');
const router = express.Router();
const syncCtrl = require('../controllers/syncController');
const { authenticate } = require('../middleware/auth');

router.post('/match', authenticate, syncCtrl.syncOfflineMatch);

module.exports = router;
