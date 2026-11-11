const Player = require('../models/Player');
const Team = require('../models/Team');
const Match = require('../models/Match');
const { logAudit } = require('../utils/logger');

function buildPlayerVisibility(req) {
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

async function listPlayers(req, res, next) {
  try {
    const { search, village, teamId, role } = req.query;
    const andClauses = [buildPlayerVisibility(req)];
    if (search) andClauses.push({ name: new RegExp(String(search), 'i') });
    if (village) andClauses.push({ village: new RegExp(String(village), 'i') });
    if (teamId) andClauses.push({ teams: teamId });
    if (role) andClauses.push({ role });

    const players = await Player.find({ $and: andClauses })
      .populate('teams', 'name shortName village')
      .sort({ 'stats.runs': -1, name: 1 })
      .lean();

    res.json({ success: true, players });
  } catch (err) {
    next(err);
  }
}

async function getPlayer(req, res, next) {
  try {
    const player = await Player.findById(req.params.id).populate('teams', 'name shortName village logoUrl');
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });

    if (player.ownerType === 'guest' && (!req.guest || req.guest.guestId !== player.guestId)) {
      return res.status(403).json({ success: false, message: 'Access denied to another guest\'s player.' });
    }

    const matches = await Match.find({
      $or: [
        { 'teamA.squad.playerId': player._id },
        { 'teamB.squad.playerId': player._id }
      ]
    })
      .sort({ matchDate: -1 })
      .limit(20)
      .lean();

    res.json({ success: true, player, matches });
  } catch (err) {
    next(err);
  }
}

async function createPlayer(req, res, next) {
  try {
    const { name, village, phone, age, jerseyNumber, battingStyle, bowlingStyle, role, teamId, photoUrl, allowDuplicate, clientId } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Player name is required.' });
    }
    const cleanVillage = village ? String(village).trim() : 'Local Ground';
    const isGuest = Boolean(req.guest && !req.user);

    // Scope duplicate detection to owner scope so guest players don't leak or collide across accounts
    if (!allowDuplicate) {
      const dupQuery = {
        name: new RegExp(`^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        village: new RegExp(`^${cleanVillage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        ...(isGuest ? { ownerType: 'guest', guestId: req.guest.guestId } : { ownerType: { $ne: 'guest' } })
      };
      const existing = await Player.findOne(dupQuery);
      if (existing) {
        if (teamId && !existing.teams.some((t) => String(t) === String(teamId))) {
          existing.teams.push(teamId);
          await existing.save();
          await Team.findByIdAndUpdate(teamId, { $addToSet: { players: existing._id } });
          return res.status(200).json({
            success: true,
            reusedExisting: true,
            message: `Existing player profile "${existing.name}" linked to the team to avoid duplicates.`,
            player: existing
          });
        }
        return res.status(409).json({
          success: false,
          duplicatePlayer: existing,
          message: `A player named "${existing.name}" from "${existing.village}" already exists.`
        });
      }
    }

    const player = await Player.create({
      ownerType: isGuest ? 'guest' : 'user',
      guestId: isGuest ? req.guest.guestId : null,
      userId: req.user ? req.user._id : null,
      clientId: clientId || null,
      name: String(name).trim(),
      village: cleanVillage,
      phone: phone ? String(phone).trim() : '',
      age: age ? Number(age) : null,
      jerseyNumber: jerseyNumber !== undefined && jerseyNumber !== '' ? Number(jerseyNumber) : null,
      battingStyle: battingStyle || 'Right-hand bat',
      bowlingStyle: bowlingStyle || 'Right-arm medium',
      role: role || 'All-rounder',
      photoUrl: photoUrl || '',
      teams: teamId ? [teamId] : [],
      createdBy: req.user ? req.user._id : null
    });

    if (teamId) {
      await Team.findByIdAndUpdate(teamId, { $addToSet: { players: player._id } });
    }

    await logAudit({ req, action: 'PLAYER_CREATED', entityType: 'Player', entityId: player._id, details: { name: player.name, ownerType: player.ownerType } });
    res.status(201).json({ success: true, player });
  } catch (err) {
    next(err);
  }
}

async function updatePlayer(req, res, next) {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });

    if (player.ownerType === 'guest' && (!req.guest || req.guest.guestId !== player.guestId)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to edit this player.' });
    }

    const fields = ['name', 'village', 'phone', 'age', 'jerseyNumber', 'battingStyle', 'bowlingStyle', 'role', 'photoUrl'];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        player[f] = req.body[f];
      }
    }
    await player.save();
    res.json({ success: true, player });
  } catch (err) {
    next(err);
  }
}

async function uploadPlayerPhoto(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });

    if (player.ownerType === 'guest' && (!req.guest || req.guest.guestId !== player.guestId)) {
      return res.status(403).json({ success: false, message: 'Permission denied.' });
    }

    player.photoUrl = `/assets/uploads/${req.file.filename}`;
    await player.save();
    res.json({ success: true, photoUrl: player.photoUrl, player });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPlayers,
  getPlayer,
  createPlayer,
  updatePlayer,
  uploadPlayerPhoto
};
