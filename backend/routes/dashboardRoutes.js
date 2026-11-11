const express = require('express');
const router = express.Router();
const dashboardCtrl = require('../controllers/dashboardController');
const { optionalAuth } = require('../middleware/auth');

router.get('/summary', optionalAuth, dashboardCtrl.getDashboardSummary);

module.exports = router;
