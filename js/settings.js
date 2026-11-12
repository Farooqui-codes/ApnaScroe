/**
 * ApnaScore Settings & Profile Controller
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    const isProfile = document.body.dataset.page === 'profile';
    ApnaUI.initShell({
      activePage: isProfile ? 'profile' : 'settings',
      pageTitle: isProfile ? 'Profile' : 'Settings'
    });

    if (isProfile) {
      await initProfilePage();
    } else {
      await initSettingsPage();
    }
  });

  function computeProfileCompletion(u) {
    const checks = [
      { ok: Boolean(u.name), label: 'Full name' },
      { ok: Boolean(u.avatarUrl && !u.avatarUrl.includes('apnascore-icon')), label: 'Profile photo' },
      { ok: Boolean(u.username), label: 'Username' },
      { ok: Boolean(u.village), label: 'Village / City' },
      { ok: Boolean(u.district || u.state), label: 'District / State' },
      { ok: Boolean(u.bio), label: 'Short bio' },
      { ok: Boolean(u.cricketProfile?.playingRole), label: 'Playing role' },
      { ok: Boolean(u.cricketProfile?.battingStyle), label: 'Batting style' }
    ];
    const done = checks.filter((c) => c.ok).length;
    const pct = Math.round((done / checks.length) * 100);
    const missing = checks.filter((c) => !c.ok).map((c) => c.label).slice(0, 3);
    return { pct, missing };
  }

  function compressSquareImage(file, size = 512, maxBytes = 200 * 1024) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = async () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - side) / 2);
        const sy = Math.floor((img.height - side) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
        const qualities = [0.85, 0.72, 0.58, 0.45];
        let blob = null;
        let ext = 'webp';
        for (const q of qualities) {
          blob = await toBlob('image/webp', q);
          if (blob && blob.type === 'image/webp' && blob.size <= maxBytes) break;
        }
        if (!blob || blob.type !== 'image/webp' || blob.size > maxBytes) {
          ext = 'jpg';
          for (const q of qualities) {
            blob = await toBlob('image/jpeg', q);
            if (blob && blob.size <= maxBytes) break;
          }
        }
        if (!blob) return reject(new Error('Image compression failed'));
        resolve(new File([blob], `avatar.${ext}`, { type: blob.type }));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Invalid image file'));
      };
      img.src = url;
    });
  }

  async function initProfilePage() {
    const hideLoggedCards = () => {
      ['profileSummaryCard', 'profileEditCard', 'profStatsCard', 'profAccountDataCard', 'profSkeleton'].forEach((id) => {
        document.getElementById(id)?.classList.add('hidden');
      });
    };

    if (!ApnaAuth.isLoggedIn()) {
      if (!ApnaAuth.isGuest()) {
        await ApnaAuth.continueAsGuest(null);
      }
      hideLoggedCards();
      const gCard = document.getElementById('guestProfileCard');
      gCard.classList.remove('hidden');

      const gp = (await ApnaOffline.getGuestProfile()) || ApnaAuth.getGuestSession() || {};
      const bundle = await ApnaOffline.getGuestMigrationBundle();
      document.getElementById('guestSessionMeta').textContent = `Guest ID: ${gp.guestId || 'Local'} • Device: ${gp.deviceId || ApnaOffline.getDeviceId()}`;
      document.getElementById('guestDataSummaryGrid').innerHTML = `
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Matches</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.matches}</div></div>
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Teams</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.teams}</div></div>
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Players</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.players}</div></div>
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Custom Rules</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.customRules}</div></div>
      `;
      document.getElementById('guestResetBtn').onclick = () => ApnaAuth.exitGuestMode();
      return;
    }

    const skel = document.getElementById('profSkeleton');
    skel?.classList.remove('hidden');
    const user = await ApnaAuth.refreshUser();
    skel?.classList.add('hidden');

    if (!user) {
      hideLoggedCards();
      const gCard = document.getElementById('guestProfileCard');
      gCard.classList.remove('hidden');
      document.getElementById('guestSessionMeta').textContent = 'Session expired. Please login again or continue as Guest.';
      document.getElementById('guestResetBtn').onclick = () => ApnaAuth.exitGuestMode();
      return;
    }

    // Check if registered user still has un-migrated guest data on device
    if (window.ApnaMigrate) {
      const eligible = await ApnaMigrate.detectEligibleGuestData();
      if (eligible) {
        const mb = document.getElementById('migrateBannerCard');
        mb.classList.remove('hidden');
        document.getElementById('migrateBannerMeta').textContent = `${eligible.counts.matches} match(es), ${eligible.counts.teams} team(s), ${eligible.counts.players} player(s) ready to migrate.`;
        document.getElementById('openMigrateModalBtn').onclick = () => ApnaMigrate.showMigrationModal({ onDone: () => window.location.reload() });
      }
    }

    function renderProfileView(u) {
      const heading = u.displayName ? `${u.name} (${u.displayName})` : u.name;
      document.getElementById('profNameHeading').textContent = heading;
      document.getElementById('profRoleSub').textContent = `${ApnaAuth.roleLabel(u.role)}${u.username ? ` • @${u.username}` : ''} • ${u.email}`;
      const loc = [u.village, u.district, u.state].filter(Boolean).join(', ');
      document.getElementById('profLocationLine').textContent = loc ? `Location: ${loc}` : '';
      document.getElementById('profBioLine').textContent = u.bio || '';
      document.getElementById('profAvatarImg').src = u.avatarUrl || '/assets/icons/apnascore-icon.png';

      const { pct, missing } = computeProfileCompletion(u);
      const pWrap = document.getElementById('profProgressWrap');
      pWrap.classList.remove('hidden');
      document.getElementById('profPctLabel').textContent = `Profile ${pct}% complete`;
      document.getElementById('profMissingHint').textContent = missing.length ? `Missing: ${missing.join(', ')}` : 'All set!';
      document.getElementById('profProgressBar').style.transform = `scaleX(${pct / 100})`;

      const isPublic = u.preferences?.privacy?.showProfilePublicly !== false;
      const pubBtn = document.getElementById('profPublicLinkBtn');
      const waBtn = document.getElementById('profShareWaBtn');
      const slug = encodeURIComponent(u.username || u._id);
      const pubPath = `/public-profile.html?id=${slug}`;
      const fullUrl = `${window.location.origin}${pubPath}`;
      if (isPublic && u._id) {
        pubBtn.href = pubPath;
        pubBtn.classList.remove('hidden');
        waBtn.href = `https://wa.me/?text=${encodeURIComponent(`Check out ${u.displayName || u.name}'s cricket profile on ApnaScore: ${fullUrl}`)}`;
        waBtn.classList.remove('hidden');
      } else {
        pubBtn.classList.add('hidden');
        waBtn.classList.add('hidden');
      }
    }

    function populateProfileForm(u) {
      document.getElementById('profNameInp').value = u.name || '';
      document.getElementById('profDisplayInp').value = u.displayName || '';
      document.getElementById('profUsernameInp').value = u.username || '';
      document.getElementById('profVillageInp').value = u.village || '';
      document.getElementById('profDistrictInp').value = u.district || '';
      document.getElementById('profStateInp').value = u.state || '';
      document.getElementById('profPhoneInp').value = u.phone || '';
      document.getElementById('profEmailInp').value = u.email || '';
      document.getElementById('profAgeInp').value = u.age || '';
      document.getElementById('profBioInp').value = u.bio || '';
      document.getElementById('profBioCounter').textContent = `${(u.bio || '').length} / 150`;
      document.getElementById('profRoleSel').value = u.cricketProfile?.playingRole || '';
      document.getElementById('profBatSel').value = u.cricketProfile?.battingStyle || '';
      document.getElementById('profBowlSel').value = u.cricketProfile?.bowlingStyle || '';
      document.getElementById('profJerseyInp').value = u.cricketProfile?.jerseyNumber ?? '';
      document.getElementById('profFavInp').value = u.cricketProfile?.favouritePlayer || '';
      document.getElementById('profClubInp').value = u.cricketProfile?.clubName || '';
      document.getElementById('profOrgNameInp').value = u.organizerProfile?.orgName || '';
      document.getElementById('privPublic').checked = u.preferences?.privacy?.showProfilePublicly !== false;
      document.getElementById('privLocation').checked = u.preferences?.privacy?.showLocation !== false;
      document.getElementById('privAge').checked = u.preferences?.privacy?.showAge !== false;
      document.getElementById('privPhone').checked = Boolean(u.preferences?.privacy?.showPhone);
    }

    renderProfileView(user);
    populateProfileForm(user);

    document.getElementById('profLogoutBtn').onclick = () => ApnaAuth.logout();

    const editCard = document.getElementById('profileEditCard');
    const toggleBtn = document.getElementById('toggleEditProfileBtn');
    toggleBtn.onclick = () => {
      const isHidden = editCard.classList.toggle('hidden');
      toggleBtn.textContent = isHidden ? 'Edit Profile' : 'Hide Edit Form';
    };

    const bioInp = document.getElementById('profBioInp');
    bioInp.addEventListener('input', () => {
      document.getElementById('profBioCounter').textContent = `${bioInp.value.length} / 150`;
    });

    let dirty = false;
    const formEl = document.getElementById('profileUpdateForm');
    formEl.addEventListener('input', () => { dirty = true; });
    formEl.addEventListener('change', () => { dirty = true; });
    window.addEventListener('beforeunload', (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    let unameTimer = null;
    const unameInp = document.getElementById('profUsernameInp');
    const unameStatus = document.getElementById('profUsernameStatus');
    unameInp.addEventListener('input', () => {
      clearTimeout(unameTimer);
      const val = unameInp.value.trim().toLowerCase();
      if (!val) { unameStatus.textContent = ''; return; }
      if (!/^[a-z0-9_]{3,24}$/.test(val)) {
        unameStatus.textContent = 'Use 3-24 lowercase letters, numbers, or _';
        unameStatus.style.color = 'var(--danger)';
        return;
      }
      unameStatus.textContent = 'Checking...';
      unameStatus.style.color = 'var(--text-muted)';
      unameTimer = setTimeout(async () => {
        try {
          const r = await ApnaAPI.get(`/api/auth/username-available?username=${encodeURIComponent(val)}`);
          unameStatus.textContent = r.available ? 'Username available' : 'Username already taken';
          unameStatus.style.color = r.available ? 'var(--primary)' : 'var(--danger)';
        } catch {
          unameStatus.textContent = '';
        }
      }, 350);
    });

    formEl.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('profNameInp').value.trim();
      const username = unameInp.value.trim().toLowerCase();
      const phone = document.getElementById('profPhoneInp').value.trim();

      if (!name) {
        ApnaUI.showToast('Full name is required', 'error');
        document.getElementById('profNameInp').focus();
        return;
      }
      if (username && !/^[a-z0-9_]{3,24}$/.test(username)) {
        ApnaUI.showToast('Username must be 3-24 chars (a-z, 0-9, _)', 'error');
        unameInp.focus();
        return;
      }
      if (phone && !/^[0-9+\-\s]{7,16}$/.test(phone)) {
        ApnaUI.showToast('Enter a valid phone number', 'error');
        document.getElementById('profPhoneInp').focus();
        return;
      }

      const jerseyRaw = document.getElementById('profJerseyInp').value.trim();
      const ageRaw = document.getElementById('profAgeInp').value.trim();
      const payload = {
        name,
        displayName: document.getElementById('profDisplayInp').value.trim(),
        username: username || undefined,
        village: document.getElementById('profVillageInp').value.trim(),
        district: document.getElementById('profDistrictInp').value.trim(),
        state: document.getElementById('profStateInp').value.trim(),
        phone,
        age: ageRaw ? Number(ageRaw) : null,
        bio: bioInp.value.trim(),
        cricketProfile: {
          playingRole: document.getElementById('profRoleSel').value,
          battingStyle: document.getElementById('profBatSel').value,
          bowlingStyle: document.getElementById('profBowlSel').value,
          jerseyNumber: jerseyRaw !== '' ? Number(jerseyRaw) : null,
          favouritePlayer: document.getElementById('profFavInp').value.trim(),
          clubName: document.getElementById('profClubInp').value.trim()
        },
        organizerProfile: {
          orgName: document.getElementById('profOrgNameInp').value.trim()
        },
        privacy: {
          showProfilePublicly: document.getElementById('privPublic').checked,
          showLocation: document.getElementById('privLocation').checked,
          showAge: document.getElementById('privAge').checked,
          showPhone: document.getElementById('privPhone').checked
        }
      };

      try {
        const res = await ApnaAPI.put('/api/auth/profile', payload);
        ApnaAPI.setSession(ApnaAPI.getToken(), res.user);
        localStorage.removeItem('apnascore_pending_profile');
        dirty = false;
        renderProfileView(res.user);
        ApnaUI.showToast('Profile updated!');
      } catch (err) {
        if (!navigator.onLine) {
          localStorage.setItem('apnascore_pending_profile', JSON.stringify(payload));
          const cached = Object.assign({}, ApnaAPI.getUser() || {}, payload);
          ApnaAPI.setSession(ApnaAPI.getToken(), cached);
          dirty = false;
          renderProfileView(cached);
          ApnaUI.showToast('Offline: Profile saved locally & will sync online.');
        } else {
          ApnaUI.showToast(err.message, 'error');
        }
      }
    };

    const handleImageUpload = async (file, endpoint, fieldName, successMsg) => {
      if (!file) return;
      try {
        const compressed = await compressSquareImage(file, 512, 200 * 1024);
        const fd = new FormData();
        fd.append(fieldName, compressed);
        const res = await ApnaAPI.upload(endpoint, fd);
        ApnaAPI.setSession(ApnaAPI.getToken(), res.user);
        renderProfileView(res.user);
        ApnaUI.showToast(successMsg);
      } catch (err) {
        ApnaUI.showToast(err.message || 'Image upload failed', 'error');
      }
    };

    document.getElementById('profAvatarInp').onchange = (e) => handleImageUpload(e.target.files[0], '/api/auth/avatar', 'avatar', 'Profile photo updated!');
    document.getElementById('profCameraInp').onchange = (e) => handleImageUpload(e.target.files[0], '/api/auth/avatar', 'avatar', 'Camera photo updated!');
    document.getElementById('profOrgLogoInp').onchange = (e) => handleImageUpload(e.target.files[0], '/api/auth/org-logo', 'logo', 'Organization logo updated!');

    document.getElementById('profRemoveAvatarBtn').onclick = async () => {
      try {
        const res = await ApnaAPI.del('/api/auth/avatar');
        ApnaAPI.setSession(ApnaAPI.getToken(), res.user);
        renderProfileView(res.user);
        ApnaUI.showToast('Photo removed');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    async function loadProfileStats() {
      try {
        const data = await ApnaAPI.get('/api/auth/profile-stats');
        const sel = document.getElementById('linkPlayerSel');
        sel.innerHTML = '<option value="">Not linked to a player yet</option>' +
          (data.myPlayers || data.availablePlayers || []).map((p) => `<option value="${p._id}" ${data.linkedPlayer && data.linkedPlayer._id === p._id ? 'selected' : ''}>${ApnaUI.escapeHtml(p.name)} (${p.role || 'Player'})</option>`).join('');

        const s = data.linkedPlayer?.stats || { matches: 0, runs: 0, wickets: 0, strikeRate: 0, highestScore: 0 };
        document.getElementById('profStatsGrid').innerHTML = `
          <div class="kpi-card"><div class="kpi-label">Matches</div><div class="kpi-value">${s.matches || 0}</div></div>
          <div class="kpi-card"><div class="kpi-label">Runs</div><div class="kpi-value">${s.runs || 0}</div></div>
          <div class="kpi-card"><div class="kpi-label">Wickets</div><div class="kpi-value">${s.wickets || 0}</div></div>
          <div class="kpi-card"><div class="kpi-label">Strike Rate</div><div class="kpi-value">${Number(s.strikeRate || 0).toFixed(1)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Highest Score</div><div class="kpi-value">${s.highestScore || 0}${s.highestNotOut ? '*' : ''}</div></div>
        `;

        const recentEl = document.getElementById('profRecentMatches');
        if (data.recentMatches && data.recentMatches.length) {
          recentEl.innerHTML = `<div class="text-sm font-bold mb-1">Recent Matches</div>` + data.recentMatches.map((m) => `
            <div class="flex-between py-1" style="border-bottom:1px solid var(--border);">
              <a href="/scorecard.html?id=${m._id}" class="text-sm">${ApnaUI.escapeHtml(m.title || 'Match')}</a>
              <span class="text-sm text-muted">${ApnaUI.escapeHtml(m.resultSummary || m.status || '')}</span>
            </div>
          `).join('');
        } else {
          recentEl.innerHTML = '<div class="text-sm text-muted">No recent matches linked yet.</div>';
        }
      } catch {
        document.getElementById('profStatsGrid').innerHTML = '<div class="text-sm text-muted">Stats unavailable offline.</div>';
      }
    }
    await loadProfileStats();

    document.getElementById('saveLinkPlayerBtn').onclick = async () => {
      try {
        const playerId = document.getElementById('linkPlayerSel').value || null;
        const res = await ApnaAPI.post('/api/auth/link-player', { playerId });
        if (res.user) ApnaAPI.setSession(ApnaAPI.getToken(), res.user);
        await loadProfileStats();
        ApnaUI.showToast(playerId ? 'Player profile linked!' : 'Player unlinked');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    document.getElementById('downloadMyDataBtn').onclick = async () => {
      try {
        const data = await ApnaAPI.get('/api/auth/export-data');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `apnascore-profile-${user.username || 'export'}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        ApnaUI.showToast('Profile data downloaded!');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    document.getElementById('openDeleteAccBtn').onclick = () => {
      document.getElementById('delAccConfirmInp').value = '';
      document.getElementById('deleteAccModal').classList.add('open');
    };
    document.getElementById('confirmDeleteAccBtn').onclick = async () => {
      if (document.getElementById('delAccConfirmInp').value.trim() !== 'DELETE') {
        ApnaUI.showToast('Please type DELETE to confirm', 'error');
        return;
      }
      try {
        await ApnaAPI.del('/api/auth/account', { confirmText: 'DELETE' });
        ApnaAPI.clearSession();
        localStorage.removeItem('apnascore_pending_profile');
        ApnaUI.showToast('Account deleted');
        window.location.href = '/index.html';
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  async function initSettingsPage() {
    const themeSel = document.getElementById('setTheme');
    themeSel.value = localStorage.getItem('apnascore_theme') || 'light';
    themeSel.onchange = () => ApnaUI.applyTheme(themeSel.value);

    document.getElementById('setOutdoor').checked = localStorage.getItem('apnascore_outdoor_mode') === '1';

    await loadSettingsData();

    document.getElementById('saveAllSettingsBtn').onclick = async () => {
      localStorage.setItem('apnascore_outdoor_mode', document.getElementById('setOutdoor').checked ? '1' : '0');
      ApnaUI.applyTheme(themeSel.value);
      if (!ApnaAuth.isLoggedIn()) {
        ApnaUI.showToast('Theme & outdoor display settings saved locally.');
        return;
      }
      const rules = ApnaScoringEngine.getDefaultRules();
      rules.format.oversPerInnings = Number(document.getElementById('defOvers').value || 6);
      rules.format.playersPerTeam = Number(document.getElementById('defPlayers').value || 11);
      rules.format.ballType = document.getElementById('defBall').value;
      rules.extras.wide.enabled = document.getElementById('defWide').checked;
      rules.extras.noBall.freeHitOnNextBall = document.getElementById('defNoBall').checked;
      rules.extras.bye.enabled = document.getElementById('defByes').checked;
      rules.extras.legBye.enabled = document.getElementById('defByes').checked;
      rules.localRules.lastManBatting = document.getElementById('defLastMan').checked;

      try {
        await ApnaAPI.put('/api/settings/preferences', {
          theme: themeSel.value,
          language: document.getElementById('setLang').value,
          outdoorMode: document.getElementById('setOutdoor').checked,
          notifications: { matchUpdates: document.getElementById('setNotifMatch').checked },
          privacy: { showProfilePublicly: document.getElementById('setPrivacyPub').checked },
          defaultScoring: {
            overs: rules.format.oversPerInnings,
            playersPerTeam: rules.format.playersPerTeam,
            ballType: rules.format.ballType,
            rules
          }
        });
        ApnaUI.showToast('Preferences saved! New matches will use these defaults.');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    document.getElementById('createPresetBtn').onclick = async () => {
      if (!ApnaAuth.isAuthenticatedOrGuest()) await ApnaAuth.continueAsGuest(null);
      const name = prompt('Enter custom preset name (e.g. My 6 Over Rules):');
      if (!name || !name.trim()) return;
      const rules = ApnaScoringEngine.getDefaultRules();
      rules.format.oversPerInnings = Number(document.getElementById('defOvers').value || 6);
      rules.format.playersPerTeam = Number(document.getElementById('defPlayers').value || 11);
      rules.format.ballType = document.getElementById('defBall').value;
      rules.localRules.lastManBatting = document.getElementById('defLastMan').checked;
      const clientId = 'lrule_' + Date.now();
      await ApnaOffline.saveRuleLocally({ localId: clientId, clientId, name: name.trim(), rules });
      try {
        await ApnaAPI.post('/api/settings/presets', { name: name.trim(), rules, clientId });
      } catch (_) {}
      ApnaUI.showToast(`Preset "${name}" saved.`);
      await loadSettingsData();
    };

    document.getElementById('changePasswordForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!ApnaAuth.requireAuth()) return;
      try {
        await ApnaAPI.put('/api/auth/password', {
          currentPassword: document.getElementById('curPwd').value,
          newPassword: document.getElementById('newPwd').value
        });
        document.getElementById('changePasswordForm').reset();
        ApnaUI.showToast('Password updated successfully.');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  async function loadSettingsData() {
    let presets = [];
    try {
      const res = await ApnaAPI.get('/api/settings');
      if (res.preferences) {
        const p = res.preferences;
        if (p.theme) {
          document.getElementById('setTheme').value = p.theme;
          ApnaUI.applyTheme(p.theme);
        }
        if (p.language) document.getElementById('setLang').value = p.language;
        document.getElementById('setOutdoor').checked = Boolean(p.outdoorMode);
        if (p.defaultScoring) {
          document.getElementById('defOvers').value = p.defaultScoring.overs || 6;
          document.getElementById('defPlayers').value = p.defaultScoring.playersPerTeam || 11;
          document.getElementById('defBall').value = p.defaultScoring.ballType || 'tennis';
        }
      }
      presets = res.presets || [];
    } catch (_) {}

    try {
      const localRules = window.ApnaOffline ? await ApnaOffline.getLocalRules().catch(() => []) : [];
      if (!presets.length && window.ApnaScoringEngine) {
        presets = ApnaScoringEngine.getRulePresets().map((r) => ({
          presetId: r.presetId,
          name: r.presetName,
          isSystemPreset: true,
          rules: r
        }));
      }
      for (const lr of localRules) {
        if (!presets.some((p) => (p.clientId && p.clientId === lr.clientId) || p.name === lr.name)) {
          presets.push(lr);
        }
      }
      const presetsEl = document.getElementById('savedPresetsList');
      if (!presetsEl) return;
      presetsEl.innerHTML = presets.length
        ? presets.map((pr) => `
          <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border-color);">
            <div>
              <strong>${ApnaUI.escapeHtml(pr.name)}</strong>
              <span class="badge ${pr.isSystemPreset ? 'badge-neutral' : 'badge-success'}">${pr.isSystemPreset ? 'Built-in' : 'Custom'}</span>
              <div class="text-sm text-muted">${pr.rules?.format?.oversPerInnings || 6} Overs • ${pr.rules?.format?.ballType || 'tennis'}</div>
            </div>
            ${!pr.isSystemPreset && pr._id ? `<button type="button" class="btn btn-danger btn-sm" onclick="deletePreset('${pr._id}')">Delete</button>` : ''}
          </div>
        `).join('')
        : '<div class="empty-state text-sm">No presets available.</div>';
    } catch (_) {}
  }

  window.deletePreset = async (id) => {
    try {
      await ApnaAPI.del(`/api/settings/presets/${id}`);
      ApnaUI.showToast('Preset deleted.');
      await loadSettingsData();
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  };
}());
