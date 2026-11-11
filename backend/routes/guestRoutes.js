const express = require('express');
const router = express.Router();
const guestCtrl = require('../controllers/guestController');
const { authenticate } = require('../middleware/auth');

router.post('/session', guestCtrl.createGuestSession);
router.get('/session', guestCtrl.getGuestSession);
router.post('/migrate', authenticate, guestCtrl.migrateGuestData);
router.get('/migrations', authenticate, guestCtrl.getMigrationJobs);

module.exports = router;
