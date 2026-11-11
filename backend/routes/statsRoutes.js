const express = require('express');
const router = express.Router();
const statsCtrl = require('../controllers/statsController');

router.get('/leaderboards', statsCtrl.getLeaderboards);

module.exports = router;
