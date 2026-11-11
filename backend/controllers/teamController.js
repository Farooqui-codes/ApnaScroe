const { v4: uuidv4 } = require('uuid');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Match = require('../models/Match');
const { logAudit } = require('../utils/logger');

function buildVisibilityFilter(req) {
  if (req.user) {
    if (req.user.role === 'super_admin') return {};
    return { ownerType: { $ne: 'guest' } };
  }
  if (req.guest) {
    return {
      $or: [
        { ownerType: 'guest', guestId: req.guest.guestId },
        { ownerType: { $ne: 'guest' } }
      ]
    };
  }
  return { ownerType: { $ne: 'guest' } };
}

async function listTeams(req, res, next) {
  try {
    const { search, village, mine } = req.query;
    const andClauses = [buildVisibilityFilter(req)];

    if (mine === '1') {
      if (req.guest) andClauses.push({ ownerType: 'guest', guestId: req.guest.guestId });
      else if (req.user) andClauses.push({ $or: [{ userId: req.user._id }, { managerId: req.user._id }] });
    }
    if (village) andClauses.push({ village: new RegExp(String(village), 'i') });
    if (search) andClauses.push({ name: new RegExp(String(search), 'i') });

    const teams = await Team.find({ $and: andClauses })
      .populate('players', 'name role battingStyle bowlingStyle jerseyNumber photoUrl')
      .populate('captainId', 'name')
      .populate('viceCaptainId', 'name')
      .sort({ 'stats.rankingPoints': -1, createdAt: -1 })
      .lean();

    res.json({ success: true, teams });
  } catch (err) {
    next(err);
  }
}

async function getTeam(req, res, next) {
  try {
    const team = await Team.findById(req.params.id)
      .populate('players')
      .populate('captainId', 'name role')
      .populate('viceCaptainId', 'name role')
      .populate('pendingInvites.playerId', 'name village role');
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    if (team.ownerType === 'guest') {
      if (!req.guest || req.guest.guestId !== team.guestId) {
        return res.status(403).json({ success: false, message: 'Access denied to another guest\'s team.' });
      }
    }

    const matches = await Match.find({
      $or: [{ 'teamA.teamId': team._id }, { 'teamB.teamId': team._id }]
    })
      .sort({ matchDate: -1 })
      .limit(20)
      .lean();

    res.json({ success: true, team, matches });
  } catch (err) {
    next(err);
  }
}

async function createTeam(req, res, next) {
  try {
    const { name, shortName, village, ownerName, logoUrl, playerIds, captainId, viceCaptainId, clientId } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Team name is required.' });
    }

    const isGuest = Boolean(req.guest && !req.user);
    const derivedShort = shortName
      ? String(shortName).toUpperCase().slice(0, 8)
      : String(name).trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'TEAM';

    const team = await Team.create({
      ownerType: isGuest ? 'guest' : 'user',
      guestId: isGuest ? req.guest.guestId : null,
      userId: req.user ? req.user._id : null,
      clientId: clientId || null,
      name: String(name).trim(),
      shortName: derivedShort,
      village: village ? String(village).trim() : 'Local Ground',
      ownerName: ownerName ? String(ownerName).trim() : '',
      logoUrl: logoUrl || '',
      managerId: req.user ? req.user._id : null,
      captainId: captainId || null,
      viceCaptainId: viceCaptainId || null,
      players: Array.isArray(playerIds) ? playerIds : [],
      inviteCode: isGuest ? '' : uuidv4().slice(0, 8).toUpperCase()
    });

    if (Array.isArray(playerIds) && playerIds.length > 0) {
      await Player.updateMany({ _id: { $in: playerIds } }, { $addToSet: { teams: team._id } });
    }

    await logAudit({ req, action: 'TEAM_CREATED', entityType: 'Team', entityId: team._id, details: { name: team.name, ownerType: team.ownerType } });
    res.status(201).json({ success: true, team });
  } catch (err) {
    next(err);
  }
}

async function updateTeam(req, res, next) {
  try {
    const team = req.team;
    const { name, shortName, village, ownerName, logoUrl, captainId, viceCaptainId } = req.body;
    if (name) team.name = String(name).trim();
    if (shortName) team.shortName = String(shortName).toUpperCase().slice(0, 8);
    if (village) team.village = String(village).trim();
    if (ownerName !== undefined) team.ownerName = String(ownerName).trim();
    if (logoUrl !== undefined) team.logoUrl = String(logoUrl);
    if (captainId !== undefined) team.captainId = captainId || null;
    if (viceCaptainId !== undefined) team.viceCaptainId = viceCaptainId || null;
    await team.save();
    res.json({ success: true, team });
  } catch (err) {
    next(err);
  }
}

async function addPlayerToTeam(req, res, next) {
  try {
    const team = req.team;
    const { playerId } = req.body;
    if (!playerId) return res.status(400).json({ success: false, message: 'playerId is required.' });

    const player = await Player.findById(playerId);
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });

    if (player.ownerType === 'guest' && (!req.guest || req.guest.guestId !== player.guestId)) {
      return res.status(403).json({ success: false, message: 'Cannot add another guest\'s player.' });
    }

    if (!team.players.some((id) => String(id) === String(player._id))) {
      team.players.push(player._id);
      await team.save();
    }
    if (!player.teams.some((id) => String(id) === String(team._id))) {
      player.teams.push(team._id);
      await player.save();
    }

    const populated = await Team.findById(team._id).populate('players');
    res.json({ success: true, team: populated });
  } catch (err) {
    next(err);
  }
}

async function removePlayerFromTeam(req, res, next) {
  try {
    const team = req.team;
    const { playerId } = req.params;
    team.players = team.players.filter((id) => String(id) !== String(playerId));
    if (String(team.captainId) === String(playerId)) team.captainId = null;
    if (String(team.viceCaptainId) === String(playerId)) team.viceCaptainId = null;
    await team.save();

    await Player.findByIdAndUpdate(playerId, { $pull: { teams: team._id } });
    const populated = await Team.findById(team._id).populate('players');
    res.json({ success: true, team: populated });
  } catch (err) {
    next(err);
  }
}

async function requestJoinTeam(req, res, next) {
  try {
    const { inviteCode, playerId } = req.body;
    const team = await Team.findOne({ inviteCode: String(inviteCode || '').toUpperCase().trim(), ownerType: 'user' });
    if (!team) return res.status(404).json({ success: false, message: 'Invalid team invite code.' });
    if (!playerId) return res.status(400).json({ success: false, message: 'playerId is required.' });

    const alreadyIn = team.players.some((id) => String(id) === String(playerId));
    if (alreadyIn) return res.status(400).json({ success: false, message: 'Player is already in this team.' });

    const pending = team.pendingInvites.find((i) => String(i.playerId) === String(playerId) && i.status === 'pending');
    if (!pending) {
      team.pendingInvites.push({ playerId, status: 'pending' });
      await team.save();
    }
    res.json({ success: true, message: 'Join request submitted for team approval.', team });
  } catch (err) {
    next(err);
  }
}

async function respondToInvite(req, res, next) {
  try {
    const team = req.team;
    const { playerId, decision } = req.body;
    const inv = team.pendingInvites.find((i) => String(i.playerId) === String(playerId) && i.status === 'pending');
    if (!inv) return res.status(404).json({ success: false, message: 'Pending invite not found.' });

    inv.status = decision === 'approved' ? 'approved' : 'rejected';
    if (inv.status === 'approved') {
      if (!team.players.some((id) => String(id) === String(playerId))) {
        team.players.push(playerId);
      }
      await Player.findByIdAndUpdate(playerId, { $addToSet: { teams: team._id } });
    }
    await team.save();
    res.json({ success: true, team });
  } catch (err) {
    next(err);
  }
}

async function uploadTeamLogo(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    req.team.logoUrl = `/assets/uploads/${req.file.filename}`;
    await req.team.save();
    res.json({ success: true, logoUrl: req.team.logoUrl, team: req.team });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  addPlayerToTeam,
  removePlayerFromTeam,
  requestJoinTeam,
  respondToInvite,
  uploadTeamLogo
};
