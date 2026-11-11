const express = require('express');
const router = express.Router();
const playerCtrl = require('../controllers/playerController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { uploadImage } = require('../middleware/upload');

router.get('/', playerCtrl.listPlayers);
router.get('/:id', playerCtrl.getPlayer);
router.post('/', authenticate, requireRole('organizer', 'team_manager', 'scorer'), playerCtrl.createPlayer);
router.put('/:id', authenticate, requireRole('organizer', 'team_manager', 'scorer'), playerCtrl.updatePlayer);
router.post('/:id/photo', authenticate, requireRole('organizer', 'team_manager', 'scorer'), uploadImage.single('photo'), playerCtrl.uploadPlayerPhoto);

module.exports = router;
