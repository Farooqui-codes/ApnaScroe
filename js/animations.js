/**
 * ApnaScore Lightweight Animations & Micro-Interactions
 * Pure CSS + IntersectionObserver + requestAnimationFrame (Zero external deps)
 */
(function (root) {
  'use strict';

  const isReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLowEnd = () => {
    const conn = navigator.connection || {};
    return Boolean(conn.saveData) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  };
  const shouldAnimate = () => !document.body.classList.contains('outdoor-mode') && !document.hidden && !isReduced();

  function animateCards(selector) {
    if (!shouldAnimate() || isLowEnd()) return;
    document.querySelectorAll(selector || '.card, .kpi-card').forEach((el, idx) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${Math.min(idx * 65, 320)}ms`;
      requestAnimationFrame(() => el.classList.add('revealed'));
    });
  }

  function celebrate(text, variant = 'four') {
    if (!shouldAnimate()) return;
    document.querySelectorAll('.celebration-banner, .six-fly-ball').forEach((n) => n.remove());

    const el = document.createElement('div');
    el.className = `celebration-banner ${variant}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 780);

    if (variant === 'six') {
      const ball = document.createElement('div');
      ball.className = 'six-fly-ball';
      document.body.appendChild(ball);
      setTimeout(() => ball.remove(), 720);
    }

    if (variant === 'wicket') {
      const view = document.getElementById('activeScoringView');
      if (view) {
        view.classList.remove('screen-shake');
        void view.offsetWidth;
        view.classList.add('screen-shake');
        setTimeout(() => view.classList.remove('screen-shake'), 380);
      }
      navigator.vibrate?.([35, 40, 35]);
    } else if (variant !== 'extra') {
      navigator.vibrate?.(16);
    }
  }

  function pulseScore(elId) {
    const el = document.getElementById(elId || 'mainScoreDigits');
    if (!el || !shouldAnimate()) return;
    el.classList.remove('score-pop');
    void el.offsetWidth;
    el.classList.add('score-pop');
  }

  function shake(el) {
    if (!el || !shouldAnimate()) return;
    el.classList.remove('input-shake');
    void el.offsetWidth;
    el.classList.add('input-shake');
    setTimeout(() => el.classList.remove('input-shake'), 320);
  }

  function initScrollAndMicroInteractions() {
    // Scroll Progress Bar
    let bar = document.getElementById('apnaScrollProgress');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'apnaScrollProgress';
      bar.className = 'scroll-progress-bar';
      document.body.appendChild(bar);
    }

    // Back to Top Button
    let topBtn = document.getElementById('apnaBackToTop');
    if (!topBtn && !document.body.classList.contains('scoring-active')) {
      topBtn = document.createElement('button');
      topBtn.id = 'apnaBackToTop';
      topBtn.type = 'button';
      topBtn.className = 'back-to-top-btn';
      topBtn.setAttribute('aria-label', 'Back to top');
      topBtn.textContent = '↑';
      topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      document.body.appendChild(topBtn);
    }

    // IntersectionObserver for Scroll Reveals + CountUp
    const reveals = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && reveals.length) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const delay = el.getAttribute('data-delay');
          if (delay) el.style.transitionDelay = `${delay}ms`;
          el.classList.add('revealed');
          obs.unobserve(el);
        });
      }, { threshold: 0.12 });
      reveals.forEach((el) => io.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add('revealed'));
    }

    // Animated Counters
    const counters = document.querySelectorAll('[data-countup]');
    if ('IntersectionObserver' in window && counters.length) {
      const cio = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = Number(el.getAttribute('data-countup')) || 0;
          const suffix = el.getAttribute('data-suffix') || '';
          if (isReduced() || isLowEnd()) {
            el.textContent = `${target}${suffix}`;
            obs.unobserve(el);
            return;
          }
          const start = performance.now();
          const dur = 850;
          const step = (now) => {
            const p = Math.min(1, (now - start) / dur);
            el.textContent = `${Math.round(target * (1 - Math.pow(1 - p, 3)))}${suffix}`;
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          obs.unobserve(el);
        });
      }, { threshold: 0.25 });
      counters.forEach((el) => cio.observe(el));
    }

    // Ripple on primary CTA
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-ripple');
      if (!btn || !shouldAnimate()) return;
      const rect = btn.getBoundingClientRect();
      const dot = document.createElement('span');
      dot.className = 'ripple-dot';
      dot.style.left = `${e.clientX - rect.left}px`;
      dot.style.top = `${e.clientY - rect.top}px`;
      btn.appendChild(dot);
      setTimeout(() => dot.remove(), 520);
    });

    // Scroll listener (progress bar, back-to-top, landing navbar, parallax, steps line)
    let lastY = window.scrollY;
    let ticking = false;
    const lpNav = document.querySelector('.lp-nav');
    const heroVisual = document.querySelector('.lp-hero-visual');
    const stepLine = document.querySelector('.steps-connector-fill');

    const onScroll = () => {
      const y = window.scrollY;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      bar.style.transform = `scaleX(${Math.min(1, y / maxScroll)})`;

      if (topBtn) topBtn.classList.toggle('visible', y > 300);

      if (lpNav) {
        lpNav.classList.toggle('lp-nav--solid', y > 24);
        lpNav.classList.toggle('lp-nav--hidden', y > 120 && y > lastY);
      }

      if (heroVisual && !isReduced() && !isLowEnd() && y < 650) {
        heroVisual.style.transform = `translateY(${Math.round(y * 0.08)}px)`;
      }

      if (stepLine) {
        const rect = stepLine.parentElement.getBoundingClientRect();
        const pct = Math.max(0.1, Math.min(1, (window.innerHeight - rect.top) / (window.innerHeight * 0.7)));
        stepLine.style.transform = `scaleX(${pct})`;
      }

      lastY = y;
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    }, { passive: true });
    onScroll();
  }

  document.addEventListener('DOMContentLoaded', initScrollAndMicroInteractions);

  root.ApnaAnimations = {
    shouldAnimate,
    animateCards,
    celebrate,
    pulseScore,
    shake
  };
}(window));
