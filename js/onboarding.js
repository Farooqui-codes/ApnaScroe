/**
 * ApnaScore First-Time User Onboarding (4 Simple Screens)
 * Shown once on first visit; skippable and never repeated after completion.
 */
(function (root) {
  'use strict';

  const DONE_KEY = 'apnascore_onboarding_done';

  const STEPS = [
    {
      title: 'Welcome to ApnaScore',
      subtitle: 'Apne Gaon ka Apna Scorer',
      body: 'Score any gully, village, or tournament cricket match right from your phone — fast, clear, and works even without internet.',
      badge: 'Step 1 of 4'
    },
    {
      title: 'Create a simple match in just a few steps.',
      subtitle: 'Start scoring in 15 seconds',
      body: 'Just enter Team A, Team B, overs, and toss — no tournament setup or complicated forms required.',
      badge: 'Step 2 of 4'
    },
    {
      title: 'Manage tournaments separately.',
      subtitle: 'Leagues, Knockouts & Points Tables',
      body: 'Whenever you organize a full tournament, open the Tournaments section for fixtures, NRR standings, and results PDFs.',
      badge: 'Step 3 of 4'
    },
    {
      title: 'Score every ball easily.',
      subtitle: 'Large outdoor-ready buttons',
      body: 'Tap 0–6, Wide, No Ball, Wicket, or Undo with one hand. Switch to Outdoor Mode in bright sunlight anytime.',
      badge: 'Step 4 of 4'
    }
  ];

  function showOnboarding(force = false) {
    if (!force && localStorage.getItem(DONE_KEY) === '1') return;

    let idx = 0;
    let backdrop = document.getElementById('apnaOnboardingBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'apnaOnboardingBackdrop';
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal-dialog" id="apnaOnboardingCard" style="max-width:440px;text-align:center;"></div>`;
      document.body.appendChild(backdrop);
    }

    const complete = () => {
      localStorage.setItem(DONE_KEY, '1');
      backdrop.classList.remove('open');
    };

    const renderStep = () => {
      const s = STEPS[idx];
      const isLast = idx === STEPS.length - 1;
      const dots = STEPS.map((_, i) =>
        `<span style="width:10px;height:10px;border-radius:50%;display:inline-block;background:${i === idx ? 'var(--brand-primary)' : 'var(--border-color)'};"></span>`
      ).join('');

      document.getElementById('apnaOnboardingCard').innerHTML = `
        <div class="flex-between mb-2">
          <span class="badge badge-success">${s.badge}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="obSkipBtn">Skip</button>
        </div>
        <img src="/assets/logos/apnascore-logo.png" alt="ApnaScore" style="width:90px;height:90px;object-fit:contain;margin:0 auto 12px;border-radius:14px;" />
        <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">${s.title}</h2>
        <p style="margin:0 0 8px;font-weight:700;color:var(--brand-primary);font-size:0.92rem;">${s.subtitle}</p>
        <p class="text-muted text-sm" style="margin:0 0 18px;">${s.body}</p>
        <div style="display:flex;justify-content:center;gap:8px;margin-bottom:18px;">${dots}</div>
        <div class="flex-between">
          ${idx > 0 ? `<button type="button" class="btn btn-secondary" id="obPrevBtn">Back</button>` : '<span></span>'}
          <button type="button" class="btn btn-primary btn-lg" id="obNextBtn">${isLast ? 'Get Started' : 'Next →'}</button>
        </div>
      `;

      document.getElementById('obSkipBtn').onclick = complete;
      document.getElementById('obPrevBtn')?.addEventListener('click', () => { idx--; renderStep(); });
      document.getElementById('obNextBtn').onclick = () => {
        if (isLast) complete();
        else { idx++; renderStep(); }
      };
    };

    renderStep();
    backdrop.classList.add('open');
  }

  root.ApnaOnboarding = { showOnboarding };
}(window));
