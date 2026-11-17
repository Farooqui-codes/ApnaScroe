const express = require('express');
const router = express.Router();
const statsCtrl = require('../controllers/statsController');

router.get('/leaderboards', statsCtrl.getLeaderboards);
router.get('/platform', statsCtrl.getPlatformStats);

module.exports = router;
