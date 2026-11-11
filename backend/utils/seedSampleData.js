const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { connectDB, disconnectDB } = require('../config/db');
const { seedSystemPresets } = require('./seedPresets');

const User = require('../models/User');
const Player = require('../models/Player');
const Team = require('../models/Team');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Delivery = require('../models/Delivery');
const Award = require('../models/Award');
const Notification = require('../models/Notification');

const engine = require('../services/scoringEngine');
const syncService = require('../services/syncService');
const statsService = require('../services/statsService');
const tournamentService = require('../services/tournamentService');

async function seedSampleDataIfEmpty() {
  const existingUsers = await User.countDocuments();
  const existingMatches = await Match.countDocuments();
  if (existingUsers > 0 || existingMatches > 0) {
    return { skipped: true, message: 'Database already contains user/match data.' };
  }

  await seedSystemPresets();

  // 1. Create Organizer User
  const passwordHash = await bcrypt.hash('ApnaScore@123', 10);
  const organizer = await User.create({
    name: 'Arjun Verma',
    email: 'organizer@apnascore.in',
    phone: '9876543210',
    village: 'Rampur',
    passwordHash,
    emailVerified: true,
    role: 'organizer'
  });

  // 2. Create 4 Village Teams & Players
  const teamConfigs = [
    {
      name: 'Rampur Lions',
      shortName: 'RL',
      village: 'Rampur',
      players: ['Raju Yadav', 'Vikram Singh', 'Aman Tiwari', 'Deepak Kumar', 'Suraj Patel', 'Ankit Sharma', 'Manoj Verma', 'Rohit Chauhan']
    },
    {
      name: 'Kishanpur Tigers',
      shortName: 'KT',
      village: 'Kishanpur',
      players: ['Suresh Maurya', 'Karan Gupta', 'Vikas Mishra', 'Pankaj Pal', 'Nitin Dubey', 'Rahul Nishad', 'Vivek Saini', 'Sumit Rawat']
    },
    {
      name: 'Bazaar Warriors',
      shortName: 'BW',
      village: 'Bazaar Khas',
      players: ['Imran Khan', 'Faizan Ali', 'Sameer Ansari', 'Ashish Bind', 'Gaurav Pandey', 'Mohit Kumar', 'Harsh Patel', 'Tarun Gautam']
    },
    {
      name: 'Nawabganj Strikers',
      shortName: 'NS',
      village: 'Nawabganj',
      players: ['Pradeep Rao', 'Ajay Chauhan', 'Dinesh Kumar', 'Kapil Sharma', 'Sandeep Verma', 'Vishal Singh', 'Lalit Yadav', 'Rinku Pal']
    }
  ];

  const createdTeams = [];
  for (const cfg of teamConfigs) {
    const team = await Team.create({
      ownerType: 'user',
      userId: organizer._id,
      managerId: organizer._id,
      name: cfg.name,
      shortName: cfg.shortName,
      village: cfg.village,
      ownerName: organizer.name,
      inviteCode: uuidv4().slice(0, 8).toUpperCase()
    });

    const roles = ['Batsman', 'All-rounder', 'Batsman', 'Wicketkeeper', 'All-rounder', 'Bowler', 'Bowler', 'Bowler'];
    const pIds = [];
    for (let i = 0; i < cfg.players.length; i++) {
      const p = await Player.create({
        ownerType: 'user',
        userId: organizer._id,
        createdBy: organizer._id,
        name: cfg.players[i],
        village: cfg.village,
        jerseyNumber: i + 1,
        role: roles[i] || 'All-rounder',
        teams: [team._id]
      });
      pIds.push(p);
    }

    team.players = pIds.map((p) => p._id);
    team.captainId = pIds[0]._id;
    team.viceCaptainId = pIds[3]._id;
    await team.save();
    createdTeams.push({ team, players: pIds });
  }

  // 3. Create Tournament + Auto Fixtures
  const rules = engine.getPresetById('village_6_over');
  rules.format.oversPerInnings = 4;

  const tournament = await Tournament.create({
    name: 'Rampur Premier League 2026',
    season: '2026',
    village: 'Rampur',
    organizerName: organizer.name,
    organizerId: organizer._id,
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    entryFee: 500,
    prizeMoney: '₹21,000 + Champions Trophy',
    maxTeams: 8,
    oversPerMatch: 4,
    ballType: 'tennis',
    format: 'league_knockout',
    status: 'ongoing',
    rulesSnapshot: rules,
    registeredTeams: createdTeams.map((ct) => ({
      teamId: ct.team._id,
      groupName: 'Group A',
      status: 'approved'
    })),
    shareCode: 'RPL2026'
  });

  const fixtures = await tournamentService.generateFixturesForTournament(tournament._id);

  // 4. Create & Score Completed Match #1 (Rampur Lions vs Kishanpur Tigers)
  const rl = createdTeams[0];
  const kt = createdTeams[1];
  const fx1 = fixtures[0];

  const m1 = await Match.create({
    ownerType: 'user',
    userId: organizer._id,
    scorerId: organizer._id,
    authorizedScorers: [organizer._id],
    title: 'Rampur Lions vs Kishanpur Tigers',
    matchCode: 'AS-RPL01',
    tournamentId: tournament._id,
    fixtureId: fx1 ? fx1._id : null,
    teamA: {
      teamId: rl.team._id,
      name: rl.team.name,
      shortName: rl.team.shortName,
      squad: rl.players.map((p) => ({ playerId: p._id, name: p.name })),
      captainId: rl.players[0]._id,
      wicketkeeperId: rl.players[3]._id
    },
    teamB: {
      teamId: kt.team._id,
      name: kt.team.name,
      shortName: kt.team.shortName,
      squad: kt.players.map((p) => ({ playerId: p._id, name: p.name })),
      captainId: kt.players[0]._id,
      wicketkeeperId: kt.players[3]._id
    },
    matchDate: new Date(Date.now() - 3600 * 1000),
    venue: 'Panchayat Ground, Rampur',
    matchType: 'league',
    ballType: 'tennis',
    oversPerInnings: 4,
    playersPerTeam: 8,
    toss: { winnerTeamId: rl.team._id, winnerTeamName: rl.team.name, decision: 'bat' },
    rulesSnapshot: rules,
    status: 'live',
    currentInningsNumber: 1,
    officials: { umpire1: 'Mahesh', scorerName: organizer.name }
  });

  const inn1 = await Innings.create({
    matchId: m1._id,
    inningsNumber: 1,
    battingTeamId: rl.team._id,
    battingTeamName: rl.team.name,
    bowlingTeamId: kt.team._id,
    bowlingTeamName: kt.team.name,
    openingStrikerId: String(rl.players[0]._id),
    openingStrikerName: rl.players[0].name,
    openingNonStrikerId: String(rl.players[1]._id),
    openingNonStrikerName: rl.players[1].name,
    openingBowlerId: String(kt.players[5]._id),
    openingBowlerName: kt.players[5].name,
    status: 'live'
  });

  const inn1Balls = [
    { eventType: 'set_openers', strikerId: String(rl.players[0]._id), strikerName: rl.players[0].name, nonStrikerId: String(rl.players[1]._id), nonStrikerName: rl.players[1].name, bowlerId: String(kt.players[5]._id), bowlerName: kt.players[5].name },
    { batRuns: 4 }, { batRuns: 6 }, { batRuns: 1 }, { batRuns: 2 }, { extraType: 'wide', additionalExtraRuns: 0 }, { batRuns: 6 }, { batRuns: 4 },
    { eventType: 'change_bowler', bowlerId: String(kt.players[6]._id), bowlerName: kt.players[6].name },
    { batRuns: 1 }, { isWicket: true, wicketType: 'caught', fielderId: String(kt.players[0]._id), fielderName: kt.players[0].name },
    { eventType: 'new_batsman', playerId: String(rl.players[2]._id), playerName: rl.players[2].name },
    { batRuns: 4 }, { batRuns: 2 }, { batRuns: 6 }, { batRuns: 1 },
    { eventType: 'end_innings' }
  ];
  for (let i = 0; i < inn1Balls.length; i++) {
    await Delivery.create({
      matchId: m1._id,
      inningsId: inn1._id,
      inningsNumber: 1,
      eventId: `seed_m1_i1_${i + 1}`,
      sequence: i + 1,
      ...inn1Balls[i]
    });
  }
  const { state: s1 } = await syncService.recomputeAndPersistInnings(m1, 1);

  const inn2 = await Innings.create({
    matchId: m1._id,
    inningsNumber: 2,
    battingTeamId: kt.team._id,
    battingTeamName: kt.team.name,
    bowlingTeamId: rl.team._id,
    bowlingTeamName: rl.team.name,
    target: s1.totalRuns + 1,
    openingStrikerId: String(kt.players[0]._id),
    openingStrikerName: kt.players[0].name,
    openingNonStrikerId: String(kt.players[1]._id),
    openingNonStrikerName: kt.players[1].name,
    openingBowlerId: String(rl.players[5]._id),
    openingBowlerName: rl.players[5].name,
    status: 'live'
  });
  m1.currentInningsNumber = 2;
  await m1.save();

  const inn2Balls = [
    { eventType: 'set_openers', strikerId: String(kt.players[0]._id), strikerName: kt.players[0].name, nonStrikerId: String(kt.players[1]._id), nonStrikerName: kt.players[1].name, bowlerId: String(rl.players[5]._id), bowlerName: rl.players[5].name },
    { batRuns: 2 }, { batRuns: 4 }, { isWicket: true, wicketType: 'bowled' },
    { eventType: 'new_batsman', playerId: String(kt.players[2]._id), playerName: kt.players[2].name },
    { batRuns: 1 }, { batRuns: 6 }, { batRuns: 0 },
    { eventType: 'end_innings' }
  ];
  for (let i = 0; i < inn2Balls.length; i++) {
    await Delivery.create({
      matchId: m1._id,
      inningsId: inn2._id,
      inningsNumber: 2,
      eventId: `seed_m1_i2_${i + 1}`,
      sequence: i + 1,
      ...inn2Balls[i]
    });
  }
  await syncService.recomputeAndPersistInnings(m1, 2);

  m1.result.playerOfMatchId = rl.players[0]._id;
  m1.result.playerOfMatchName = rl.players[0].name;
  await m1.save();
  await syncService.upsertScorecard(m1);

  await Award.create({
    awardType: 'player_of_match',
    title: 'Player of the Match',
    playerId: rl.players[0]._id,
    playerName: rl.players[0].name,
    teamId: rl.team._id,
    teamName: rl.team.name,
    matchId: m1._id,
    tournamentId: tournament._id,
    metricText: m1.result.marginText
  });

  if (fx1) {
    await TournamentFixture.findByIdAndUpdate(fx1._id, {
      matchId: m1._id,
      status: 'completed',
      winnerTeamId: m1.result.winnerTeamId,
      resultText: m1.result.marginText
    });
  }
  await tournamentService.rebuildPointsTable(tournament._id);
  await statsService.syncPlayersAndTeamsForMatch(m1._id);

  // 5. Create Live Match #2 (Bazaar Warriors vs Nawabganj Strikers)
  const bw = createdTeams[2];
  const ns = createdTeams[3];
  const m2 = await Match.create({
    ownerType: 'user',
    userId: organizer._id,
    scorerId: organizer._id,
    authorizedScorers: [organizer._id],
    title: 'Bazaar Warriors vs Nawabganj Strikers',
    matchCode: 'AS-LIVE1',
    tournamentId: tournament._id,
    teamA: { teamId: bw.team._id, name: bw.team.name, shortName: bw.team.shortName, squad: bw.players.map((p) => ({ playerId: p._id, name: p.name })) },
    teamB: { teamId: ns.team._id, name: ns.team.name, shortName: ns.team.shortName, squad: ns.players.map((p) => ({ playerId: p._id, name: p.name })) },
    matchDate: new Date(),
    venue: 'Panchayat Ground, Rampur',
    matchType: 'league',
    ballType: 'tennis',
    oversPerInnings: 4,
    playersPerTeam: 8,
    toss: { winnerTeamId: bw.team._id, winnerTeamName: bw.team.name, decision: 'bat' },
    rulesSnapshot: rules,
    status: 'live',
    currentInningsNumber: 1
  });
  const m2Inn1 = await Innings.create({
    matchId: m2._id,
    inningsNumber: 1,
    battingTeamId: bw.team._id,
    battingTeamName: bw.team.name,
    bowlingTeamId: ns.team._id,
    bowlingTeamName: ns.team.name,
    openingStrikerId: String(bw.players[0]._id),
    openingStrikerName: bw.players[0].name,
    openingNonStrikerId: String(bw.players[1]._id),
    openingNonStrikerName: bw.players[1].name,
    openingBowlerId: String(ns.players[5]._id),
    openingBowlerName: ns.players[5].name,
    status: 'live'
  });
  const liveBalls = [
    { eventType: 'set_openers', strikerId: String(bw.players[0]._id), strikerName: bw.players[0].name, nonStrikerId: String(bw.players[1]._id), nonStrikerName: bw.players[1].name, bowlerId: String(ns.players[5]._id), bowlerName: ns.players[5].name },
    { batRuns: 4 }, { batRuns: 1 }, { batRuns: 6 }, { extraType: 'no_ball', batRuns: 2 }
  ];
  for (let i = 0; i < liveBalls.length; i++) {
    await Delivery.create({
      matchId: m2._id,
      inningsId: m2Inn1._id,
      inningsNumber: 1,
      eventId: `seed_m2_i1_${i + 1}`,
      sequence: i + 1,
      ...liveBalls[i]
    });
  }
  await syncService.recomputeAndPersistInnings(m2, 1);

  await Notification.create({
    userId: organizer._id,
    type: 'match_live',
    title: 'Match Live: Bazaar Warriors vs Nawabganj Strikers',
    message: 'Rampur Premier League 2026 match is underway!',
    link: `/live-score.html?matchId=${m2._id}`
  });

  return {
    skipped: false,
    organizerEmail: organizer.email,
    teamsCreated: createdTeams.length,
    matchesCreated: 2
  };
}

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      const res = await seedSampleDataIfEmpty();
      console.log('[ApnaScore Seed]', res);
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error('[ApnaScore Seed Error]', err);
      process.exit(1);
    }
  })();
}

module.exports = { seedSampleDataIfEmpty };
