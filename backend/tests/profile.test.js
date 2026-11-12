const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { createApp } = require('../server');
const { seedSystemPresets } = require('../utils/seedPresets');
const Player = require('../models/Player');

describe('User Profile, Privacy, Player Linking & Account Controls (E2E)', () => {
  let mongod;
  let server;
  let baseUrl;

  before(async () => {
    const localTestUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apnascore_profile_e2e_test';
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
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  async function req(path, { method = 'GET', token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  it('supports username availability, full profile update, player linking, privacy, export & deletion', async () => {
    const reg = await req('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Raju Yadav',
        email: 'raju.profile@example.com',
        password: 'password123',
        role: 'scorer'
      }
    });
    assert.equal(reg.status, 201);
    const token = reg.data.token;
    assert.ok(token);

    // 1. Username availability
    const avail1 = await req('/api/auth/username-available?username=raju_scorer', { token });
    assert.equal(avail1.status, 200);
    assert.equal(avail1.data.available, true);

    // 2. Full profile update
    const upd = await req('/api/auth/profile', {
      method: 'PUT',
      token,
      body: {
        name: 'Raju Yadav',
        displayName: 'RajuBhai',
        username: 'raju_scorer',
        village: 'Rampur',
        district: 'Varanasi',
        state: 'UP',
        phone: '9876543210',
        age: 24,
        bio: 'Tennis ball all-rounder from Rampur',
        cricketProfile: {
          playingRole: 'All-rounder',
          battingStyle: 'Right-hand bat',
          bowlingStyle: 'Medium',
          jerseyNumber: 7,
          favouritePlayer: 'MS Dhoni',
          clubName: 'Rampur XI'
        },
        privacy: {
          showProfilePublicly: true,
          showLocation: true,
          showAge: true,
          showPhone: false
        }
      }
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.user.username, 'raju_scorer');
    assert.equal(upd.data.user.displayName, 'RajuBhai');

    // 3. Create & link a Player
    const player = await Player.create({
      name: 'Raju Yadav',
      role: 'All-rounder',
      userId: upd.data.user._id,
      createdBy: upd.data.user._id,
      stats: { matches: 12, runs: 420, wickets: 14, strikeRate: 145.5, highestScore: 88, highestNotOut: true }
    });
    const linkRes = await req('/api/auth/link-player', {
      method: 'POST',
      token,
      body: { playerId: player._id.toString() }
    });
    assert.equal(linkRes.status, 200);
    assert.equal(linkRes.data.user.linkedPlayerId.toString(), player._id.toString());

    const statsRes = await req('/api/auth/profile-stats', { token });
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.data.linkedPlayer.stats.runs, 420);

    // 4. Public profile hides email & phone by default
    const pub1 = await req('/api/public/profiles/raju_scorer');
    assert.equal(pub1.status, 200);
    assert.equal(pub1.data.profile.email, undefined);
    assert.ok(!pub1.data.profile.phone);
    assert.ok(pub1.data.profile.location.includes('Rampur'));
    assert.equal(pub1.data.stats.runs, 420);

    // Reveal phone when showPhone: true
    await req('/api/auth/profile', {
      method: 'PUT',
      token,
      body: { privacy: { showProfilePublicly: true, showLocation: true, showAge: true, showPhone: true } }
    });
    const pub2 = await req('/api/public/profiles/raju_scorer');
    assert.equal(pub2.status, 200);
    assert.equal(pub2.data.profile.phone, '9876543210');

    // 5. Data export
    const exp = await req('/api/auth/export-data', { token });
    assert.equal(exp.status, 200);
    assert.equal(exp.data.profile.username, 'raju_scorer');

    // 6. Account deletion
    const del = await req('/api/auth/account', { method: 'DELETE', token, body: { confirmText: 'DELETE' } });
    assert.equal(del.status, 200);
    const meAfter = await req('/api/auth/me', { token });
    assert.equal(meAfter.status, 401);
  });
});
