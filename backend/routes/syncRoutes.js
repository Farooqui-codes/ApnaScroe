const express = require('express');
const router = express.Router();
const syncCtrl = require('../controllers/syncController');
const { authenticateOrGuest } = require('../middleware/auth');

router.post('/match', authenticateOrGuest, syncCtrl.syncOfflineMatch);

module.exports = router;
