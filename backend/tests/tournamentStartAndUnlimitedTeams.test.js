const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { createApp } = require('../server');
const { seedSystemPresets } = require('../utils/seedPresets');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const Team = require('../models/Team');
const Match = require('../models/Match');
const tournamentService = require('../services/tournamentService');

describe('Tournament Creation, Start Option & Unlimited Teams Verification', () => {
  let mongod;
  let server;
  let baseUrl;
  let guestHeaders = {};

  before(async () => {
    const localTestUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apnascore_tour_test';
    try {
      await mongoose.connect(localTestUri, { serverSelectionTimeoutMS: 2500 });
      await mongoose.connection.dropDatabase();
    } catch (_) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    }
    await seedSystemPresets();

    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create guest session
    const gRes = await fetch(`${baseUrl}/api/guest/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev_tour_test_1' })
    });
    const gBody = await gRes.json();
    assert.equal(gRes.status, 201);
    guestHeaders = {
      'X-Guest-Id': gBody.guestId,
      'X-Guest-Token': gBody.guestToken
    };
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongod) await mongod.stop();
  });

  async function api(method, path, body = null, extraHeaders = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, guestHeaders, extraHeaders);
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  it('1. Creates a tournament with unlimited teams (maxTeams: 0) and status upcoming', async () => {
    const res = await api('POST', '/api/tournaments', {
      name: 'Rampur Premier League',
      village: 'Rampur',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      format: 'league',
      oversPerMatch: 8,
      unlimitedTeams: true,
      maxTeams: 0
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.tournament.name, 'Rampur Premier League');
    assert.equal(res.data.tournament.maxTeams, 0, 'maxTeams should be 0 representing unlimited');
    assert.equal(res.data.tournament.status, 'upcoming', 'status should be upcoming before starting');
    assert.equal(res.data.tournament.registeredTeams.length, 0);
  });

  it('2. Fails to start tournament when fewer than 2 teams are registered', async () => {
    const createRes = await api('POST', '/api/tournaments', {
      name: 'Solitary Cup',
      village: 'Rampur',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      format: 'knockout',
      unlimitedTeams: true
    });
    const tourId = createRes.data.tournament._id;

    // Attempt to start with 0 teams
    const startRes0 = await api('POST', `/api/tournaments/${tourId}/start`, {});
    assert.equal(startRes0.status, 400);
    assert.match(startRes0.data.message, /at least 2 approved teams/i);

    // Add 1 team
    await api('POST', `/api/tournaments/${tourId}/register-team`, {
      teamName: 'Single Team XI'
    });

    // Attempt to start with 1 team
    const startRes1 = await api('POST', `/api/tournaments/${tourId}/start`, {});
    assert.equal(startRes1.status, 400);
    assert.match(startRes1.data.message, /at least 2 approved teams/i);
  });

  it('3. Allows adding unlimited teams (> 10 teams) via quick add teamName & teamId', async () => {
    const createRes = await api('POST', '/api/tournaments', {
      name: 'Mega Village Championship',
      village: 'Kalyanpur',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      format: 'league_knockout',
      unlimitedTeams: true,
      maxTeams: 0
    });
    const tourId = createRes.data.tournament._id;

    // Add 12 teams dynamically
    for (let i = 1; i <= 12; i++) {
      const reg = await api('POST', `/api/tournaments/${tourId}/register-team`, {
        teamName: `Village Team ${i}`,
        village: 'Kalyanpur'
      });
      assert.equal(reg.status, 200);
      assert.equal(reg.data.success, true);
    }

    const getRes = await api('GET', `/api/tournaments/${tourId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.tournament.registeredTeams.length, 12, '12 teams successfully registered under unlimited mode');
  });

  it('4. Successfully starts tournament: changes status to ongoing & auto-generates fixtures', async () => {
    const createRes = await api('POST', '/api/tournaments', {
      name: 'Four Nations Cup',
      village: 'Sultanpur',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      format: 'knockout',
      oversPerMatch: 10,
      unlimitedTeams: true
    });
    const tourId = createRes.data.tournament._id;
    assert.equal(createRes.data.tournament.status, 'upcoming');

    // Register 4 teams
    await api('POST', `/api/tournaments/${tourId}/register-team`, { teamName: 'Warriors' });
    await api('POST', `/api/tournaments/${tourId}/register-team`, { teamName: 'Kings' });
    await api('POST', `/api/tournaments/${tourId}/register-team`, { teamName: 'Titans' });
    await api('POST', `/api/tournaments/${tourId}/register-team`, { teamName: 'Royals' });

    // START TOURNAMENT
    const startRes = await api('POST', `/api/tournaments/${tourId}/start`, {});
    assert.equal(startRes.status, 200);
    assert.equal(startRes.data.success, true);
    assert.equal(startRes.data.tournament.status, 'ongoing', 'Tournament status changed to ongoing');
    assert.ok(startRes.data.fixtures.length > 0, 'Fixtures automatically generated upon starting tournament');

    // Check fixtures from GET /api/tournaments/:id
    const tourDetail = await api('GET', `/api/tournaments/${tourId}`);
    assert.equal(tourDetail.data.tournament.status, 'ongoing');
    assert.ok(tourDetail.data.fixtures.length >= 3, '4-team knockout generates 2 Semi-Finals and 1 Final');
  });

  it('5. Creates and plays a tournament match for Fixture #1 and updates tournament points/standings', async () => {
    const createRes = await api('POST', '/api/tournaments', {
      name: 'Dangal League',
      village: 'Baghpat',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      format: 'league',
      oversPerMatch: 5,
      unlimitedTeams: true
    });
    const tourId = createRes.data.tournament._id;

    // Register 2 teams
    const r1 = await api('POST', `/api/tournaments/${tourId}/register-team`, { teamName: 'Team Alpha' });
    const r2 = await api('POST', `/api/tournaments/${tourId}/register-team`, { teamName: 'Team Beta' });
    const teamAId = r1.data.newTeam._id;
    const teamBId = r2.data.newTeam._id;

    // Start tournament
    const startRes = await api('POST', `/api/tournaments/${tourId}/start`, {});
    assert.equal(startRes.status, 200);
    const fixture1 = startRes.data.fixtures[0];
    assert.ok(fixture1, 'Fixture #1 exists');

    // Create Match linked to this tournament & fixture
    const matchRes = await api('POST', '/api/matches', {
      title: 'Alpha vs Beta',
      tournamentId: tourId,
      fixtureId: fixture1._id,
      matchType: 'tournament',
      teamAId,
      teamBId,
      oversPerInnings: 5,
      tossWinnerTeamId: teamAId,
      tossDecision: 'bat'
    });
    assert.equal(matchRes.status, 201);
    const matchId = matchRes.data.match._id;

    // Complete the match with Team Alpha winning
    const completeRes = await api('POST', `/api/matches/${matchId}/control`, {
      action: 'complete',
      winnerTeamId: teamAId,
      marginText: 'Team Alpha won by 10 runs'
    });
    assert.equal(completeRes.status, 200);

    // Verify fixture was updated with matchId & status completed
    const updatedFixture = await TournamentFixture.findById(fixture1._id);
    assert.equal(updatedFixture.status, 'completed');
    assert.equal(String(updatedFixture.winnerTeamId), String(teamAId));

    // Verify Points Table was recalculated
    const points = await PointsTable.find({ tournamentId: tourId }).lean();
    assert.ok(points.length >= 2);
    const alphaPoints = points.find((p) => String(p.teamId) === String(teamAId));
    assert.ok(alphaPoints);
    assert.equal(alphaPoints.won, 1);
    assert.equal(alphaPoints.points, 2);
  });

  it('6. Generates full multi-round knockout bracket for 16 teams under unlimited mode', async () => {
    const teams = [];
    for (let i = 1; i <= 16; i++) {
      const tm = await Team.create({
        ownerType: 'guest',
        guestId: guestHeaders['X-Guest-Id'],
        name: `Knockout Squad ${i}`,
        village: 'Test Nagar'
      });
      teams.push(tm);
    }

    const tour = await Tournament.create({
      name: '16 Teams Mega Knockout',
      village: 'Test Nagar',
      ownerType: 'guest',
      guestId: guestHeaders['X-Guest-Id'],
      startDate: new Date(),
      endDate: new Date(),
      format: 'knockout',
      maxTeams: 0,
      status: 'upcoming',
      registeredTeams: teams.map((t) => ({ teamId: t._id, status: 'approved' }))
    });

    const fixtures = await tournamentService.generateFixturesForTournament(tour._id);
    // 16 teams = 8 Round of 16 + 4 Quarter-Finals + 2 Semi-Finals + 1 Final = 15 matches
    assert.equal(fixtures.length, 15);
    const round1 = fixtures.filter((f) => f.roundOrder === 1);
    const qf = fixtures.filter((f) => f.roundName.includes('Quarter-Final'));
    const sf = fixtures.filter((f) => f.roundName.includes('Semi-Final'));
    const fn = fixtures.filter((f) => f.roundName === 'Final');

    assert.equal(round1.length, 8);
    assert.equal(qf.length, 4);
    assert.equal(sf.length, 2);
    assert.equal(fn.length, 1);
  });
});
