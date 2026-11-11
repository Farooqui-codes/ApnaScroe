const Player = require('../models/Player');
const Team = require('../models/Team');
const Match = require('../models/Match');
const { logAudit } = require('../utils/logger');

async function listPlayers(req, res, next) {
  try {
    const { search, village, teamId, role } = req.query;
    const query = {};
    if (search) query.name = new RegExp(String(search), 'i');
    if (village) query.village = new RegExp(String(village), 'i');
    if (teamId) query.teams = teamId;
    if (role) query.role = role;

    const players = await Player.find(query)
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
    const { name, village, phone, age, jerseyNumber, battingStyle, bowlingStyle, role, teamId, photoUrl, allowDuplicate } = req.body;
    if (!name || !village) {
      return res.status(400).json({ success: false, message: 'Player name and village are required.' });
    }

    // Duplicate prevention: check existing player in same village with same name (case-insensitive)
    if (!allowDuplicate) {
      const existing = await Player.findOne({
        name: new RegExp(`^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        village: new RegExp(`^${String(village).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      });
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
          message: `A player named "${existing.name}" from "${existing.village}" already exists. Link their existing profile instead.`
        });
      }
    }

    const player = await Player.create({
      name: String(name).trim(),
      village: String(village).trim(),
      phone: phone ? String(phone).trim() : '',
      age: age ? Number(age) : null,
      jerseyNumber: jerseyNumber !== undefined && jerseyNumber !== '' ? Number(jerseyNumber) : null,
      battingStyle: battingStyle || 'Right-hand bat',
      bowlingStyle: bowlingStyle || 'Right-arm medium',
      role: role || 'All-rounder',
      photoUrl: photoUrl || '',
      teams: teamId ? [teamId] : [],
      createdBy: req.user._id
    });

    if (teamId) {
      await Team.findByIdAndUpdate(teamId, { $addToSet: { players: player._id } });
    }

    await logAudit({ req, action: 'PLAYER_CREATED', entityType: 'Player', entityId: player._id, details: { name: player.name } });
    res.status(201).json({ success: true, player });
  } catch (err) {
    next(err);
  }
}

async function updatePlayer(req, res, next) {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });

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
    const player = await Player.findByIdAndUpdate(
      req.params.id,
      { photoUrl: `/assets/uploads/${req.file.filename}` },
      { new: true }
    );
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });
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
