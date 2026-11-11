const express = require('express');
const router = express.Router();
const teamCtrl = require('../controllers/teamController');
const { authenticate, authenticateOrGuest, optionalAuth } = require('../middleware/auth');
const { requireRegisteredOrGuestScoring, canManageTeam } = require('../middleware/rbac');
const { uploadImage } = require('../middleware/upload');

router.get('/', optionalAuth, teamCtrl.listTeams);
router.get('/:id', optionalAuth, teamCtrl.getTeam);
router.post('/', authenticateOrGuest, requireRegisteredOrGuestScoring, teamCtrl.createTeam);
router.post('/join-request', authenticate, teamCtrl.requestJoinTeam);
router.put('/:id', authenticateOrGuest, canManageTeam, teamCtrl.updateTeam);
router.post('/:id/players', authenticateOrGuest, canManageTeam, teamCtrl.addPlayerToTeam);
router.delete('/:id/players/:playerId', authenticateOrGuest, canManageTeam, teamCtrl.removePlayerFromTeam);
router.post('/:id/invites/respond', authenticate, canManageTeam, teamCtrl.respondToInvite);
router.post('/:id/logo', authenticateOrGuest, canManageTeam, uploadImage.single('logo'), teamCtrl.uploadTeamLogo);

module.exports = router;
