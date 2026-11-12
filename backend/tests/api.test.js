const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server');
const { requireRole } = require('../middleware/rbac');

describe('Express App HTTP, Security & RBAC Integration Checks', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns 200 OK on /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.app, 'ApnaScore');
  });

  it('serves all frontend HTML pages, manifest, service worker, and logo assets', async () => {
    const paths = [
      '/index.html',
      '/login.html',
      '/register.html',
      '/dashboard.html',
      '/my-matches.html',
      '/live-score.html',
      '/match-create.html',
      '/tournament.html',
      '/js/my-matches.js',
      '/js/onboarding.js',
      '/team.html',
      '/player.html',
      '/scorecard.html',
      '/statistics.html',
      '/leaderboards.html',
      '/settings.html',
      '/profile.html',
      '/public-match.html',
      '/public-tournament.html',
      '/manifest.json',
      '/service-worker.js',
      '/robots.txt',
      '/sitemap.xml',
      '/health',
      '/assets/logos/apnascore-logo.png',
      '/assets/images/apnascore-og-preview.jpg',
      '/assets/icons/apnascore-icon.png',
      '/assets/icons/favicon-32.png'
    ];
    for (const p of paths) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 200, `Expected 200 OK for ${p}, got ${res.status}`);
    }

    // Verify Open Graph & Twitter link preview tags on public-match.html and index.html
    const pmHtml = await (await fetch(`${baseUrl}/public-match.html`)).text();
    assert.match(pmHtml, /<meta property="og:title"/);
    assert.match(pmHtml, /<meta property="og:description"/);
    assert.match(pmHtml, /apnascore-og-preview\.jpg/);
    assert.match(pmHtml, /<meta name="twitter:card" content="summary_large_image"/);
  });

  it('blocks direct access to /backend and /.env', async () => {
    const r1 = await fetch(`${baseUrl}/backend/server.js`);
    assert.equal(r1.status, 403);
    const r2 = await fetch(`${baseUrl}/.env`);
    assert.equal(r2.status, 403);
  });

  it('enforces 401 authentication on protected mutation endpoints', async () => {
    const protectedEndpoints = [
      { method: 'POST', path: '/api/matches' },
      { method: 'POST', path: '/api/teams' },
      { method: 'POST', path: '/api/players' },
      { method: 'POST', path: '/api/tournaments' },
      { method: 'POST', path: '/api/sync/match' },
      { method: 'PUT', path: '/api/settings/preferences' }
    ];
    for (const ep of protectedEndpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(res.status, 401, `Expected 401 on ${ep.method} ${ep.path}`);
    }
  });

  it('enforces RBAC roles properly via requireRole middleware', () => {
    const guard = requireRole('organizer');
    let statusSet = 0;
    let passed = false;

    // Viewer should be denied (403)
    guard(
      { user: { role: 'viewer' } },
      { status: (s) => { statusSet = s; return { json: () => {} }; } },
      () => { passed = true; }
    );
    assert.equal(passed, false);
    assert.equal(statusSet, 403);

    // Organizer and Super Admin should pass
    passed = false;
    guard({ user: { role: 'organizer' } }, {}, () => { passed = true; });
    assert.equal(passed, true);

    passed = false;
    guard({ user: { role: 'super_admin' } }, {}, () => { passed = true; });
    assert.equal(passed, true);
  });
});
