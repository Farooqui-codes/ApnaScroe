const express = require('express');
const router = express.Router();
const teamCtrl = require('../controllers/teamController');
const { authenticate } = require('../middleware/auth');
const { requireRole, canManageTeam } = require('../middleware/rbac');
const { uploadImage } = require('../middleware/upload');

router.get('/', teamCtrl.listTeams);
router.get('/:id', teamCtrl.getTeam);
router.post('/', authenticate, requireRole('organizer', 'team_manager', 'scorer'), teamCtrl.createTeam);
router.post('/join-request', authenticate, teamCtrl.requestJoinTeam);
router.put('/:id', authenticate, canManageTeam, teamCtrl.updateTeam);
router.post('/:id/players', authenticate, canManageTeam, teamCtrl.addPlayerToTeam);
router.delete('/:id/players/:playerId', authenticate, canManageTeam, teamCtrl.removePlayerFromTeam);
router.post('/:id/invites/respond', authenticate, canManageTeam, teamCtrl.respondToInvite);
router.post('/:id/logo', authenticate, canManageTeam, uploadImage.single('logo'), teamCtrl.uploadTeamLogo);

module.exports = router;
