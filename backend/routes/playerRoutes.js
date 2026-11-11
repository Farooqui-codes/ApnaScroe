const express = require('express');
const router = express.Router();
const playerCtrl = require('../controllers/playerController');
const { authenticateOrGuest, optionalAuth } = require('../middleware/auth');
const { requireRegisteredOrGuestScoring } = require('../middleware/rbac');
const { uploadImage } = require('../middleware/upload');

router.get('/', optionalAuth, playerCtrl.listPlayers);
router.get('/:id', optionalAuth, playerCtrl.getPlayer);
router.post('/', authenticateOrGuest, requireRegisteredOrGuestScoring, playerCtrl.createPlayer);
router.put('/:id', authenticateOrGuest, requireRegisteredOrGuestScoring, playerCtrl.updatePlayer);
router.post('/:id/photo', authenticateOrGuest, requireRegisteredOrGuestScoring, uploadImage.single('photo'), playerCtrl.uploadPlayerPhoto);

module.exports = router;
