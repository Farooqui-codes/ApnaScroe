/**
 * ApnaScore Animations & Micro-Interactions
 * Self-hosted GSAP + ScrollTrigger + Lenis + Lazy Lottie with pure-CSS fallbacks
 */
(function (root) {
  'use strict';

  const isReduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isLowEnd = () => {
    const conn = navigator.connection || {};
    return Boolean(conn.saveData) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  };
  const effectsEnabled = () => localStorage.getItem('apnascore_effects') !== '0';
  const shouldAnimate = () =>
    effectsEnabled() &&
    !document.body.classList.contains('outdoor-mode') &&
    !document.hidden &&
    !isReduced();

  let lottieLoadPromise = null;
  const lottieDataCache = {};
  let lenisInstance = null;

  function preloadLottie() {
    if (!effectsEnabled() || isReduced()) return Promise.resolve(null);
    if (lottieLoadPromise) return lottieLoadPromise;

    lottieLoadPromise = new Promise((resolve) => {
      const fetchJson = () => {
        const types = ['six', 'four', 'wicket'];
        Promise.all(
          types.map((t) =>
            fetch(`/assets/lottie/${t}.json`)
              .then((r) => (r.ok ? r.json() : null))
              .then((json) => { if (json) lottieDataCache[t] = json; })
              .catch(() => {})
          )
        ).finally(() => resolve(window.lottie || null));
      };

      if (window.lottie) {
        fetchJson();
        return;
      }

      const s = document.createElement('script');
      s.src = '/js/vendor/lottie_light.min.js';
      s.defer = true;
      s.onload = fetchJson;
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });

    return lottieLoadPromise;
  }

  function animateCards(selector) {
    if (!shouldAnimate() || isLowEnd()) return;
    const nodes = document.querySelectorAll(selector || '.card, .kpi-card');
    if (!nodes.length) return;

    if (window.gsap) {
      window.gsap.fromTo(
        nodes,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.36, stagger: 0.05, ease: 'power2.out', clearProps: 'transform,opacity' }
      );
      return;
    }

    nodes.forEach((el, idx) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${Math.min(idx * 65, 320)}ms`;
      requestAnimationFrame(() => el.classList.add('revealed'));
    });
  }

  function playLottieOverlay(variant) {
    const json = lottieDataCache[variant];
    if (!window.lottie || !json) return;

    const host = document.createElement('div');
    host.className = 'lottie-celebration-overlay';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:248;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'width:220px;height:220px;pointer-events:none;';
    host.appendChild(box);
    document.body.appendChild(host);

    try {
      const anim = window.lottie.loadAnimation({
        container: box,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData: JSON.parse(JSON.stringify(json))
      });
      setTimeout(() => {
        try { anim.destroy(); } catch {}
        host.remove();
      }, 880);
    } catch {
      host.remove();
    }
  }

  function celebrate(text, variant = 'four') {
    if (!shouldAnimate()) return;
    document.querySelectorAll('.celebration-banner, .six-fly-ball, .lottie-celebration-overlay').forEach((n) => n.remove());

    const el = document.createElement('div');
    el.className = `celebration-banner ${variant}`;
    el.textContent = text;
    document.body.appendChild(el);

    if (window.gsap) {
      window.gsap.fromTo(
        el,
        { opacity: 0, scale: 0.72, y: -14 },
        { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'back.out(1.7)' }
      );
      window.gsap.to(el, { opacity: 0, y: -10, duration: 0.22, delay: 0.62, onComplete: () => el.remove() });
    } else {
      setTimeout(() => el.remove(), 780);
    }

    if (variant === 'six' || variant === 'four' || variant === 'wicket') {
      if (window.lottie && lottieDataCache[variant]) {
        playLottieOverlay(variant);
      } else {
        preloadLottie();
        if (variant === 'six') {
          const ball = document.createElement('div');
          ball.className = 'six-fly-ball';
          document.body.appendChild(ball);
          setTimeout(() => ball.remove(), 720);
        }
      }
    }

    if (variant === 'wicket') {
      const view = document.getElementById('activeScoringView');
      if (view) {
        if (window.gsap) {
          window.gsap.fromTo(view, { x: -6 }, { x: 0, duration: 0.32, ease: 'elastic.out(1, 0.35)', clearProps: 'transform' });
        } else {
          view.classList.remove('screen-shake');
          void view.offsetWidth;
          view.classList.add('screen-shake');
          setTimeout(() => view.classList.remove('screen-shake'), 380);
        }
      }
      navigator.vibrate?.([35, 40, 35]);
    } else if (variant !== 'extra') {
      navigator.vibrate?.(16);
    }
  }

  function pulseScore(elId) {
    const el = document.getElementById(elId || 'mainScoreDigits');
    if (!el || !shouldAnimate()) return;
    if (window.gsap) {
      window.gsap.fromTo(el, { scale: 1.14 }, { scale: 1, duration: 0.22, ease: 'power2.out', clearProps: 'transform' });
      return;
    }
    el.classList.remove('score-pop');
    void el.offsetWidth;
    el.classList.add('score-pop');
  }

  function shake(el) {
    if (!el || !shouldAnimate()) return;
    if (window.gsap) {
      window.gsap.fromTo(el, { x: -7 }, { x: 0, duration: 0.3, ease: 'elastic.out(1, 0.3)', clearProps: 'transform' });
      return;
    }
    el.classList.remove('input-shake');
    void el.offsetWidth;
    el.classList.add('input-shake');
    setTimeout(() => el.classList.remove('input-shake'), 320);
  }

  function initGsapAndLenis(bar, topBtn) {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    if (!gsap) return false;

    if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

    // Lenis Smooth Scroll on landing & long pages (skip on low-end / reduced motion)
    if (window.Lenis && !isReduced() && !isLowEnd() && !document.body.classList.contains('scoring-active')) {
      try {
        lenisInstance = new window.Lenis({ duration: 1.05, smoothWheel: true, touchMultiplier: 1.4 });
        if (ScrollTrigger) lenisInstance.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time) => {
          if (lenisInstance) lenisInstance.raf(time * 1000);
        });
        gsap.ticker.lagSmoothing(0);
      } catch {
        lenisInstance = null;
      }
    }

    const mm = gsap.matchMedia();

    // Hero timeline (Landing page)
    const hero = document.querySelector('.lp-hero');
    if (hero && !isReduced()) {
      const heroItems = hero.querySelectorAll('h1, p, .btn, .badge');
      gsap.fromTo(
        heroItems,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.48, stagger: 0.07, ease: 'power2.out', clearProps: 'transform,opacity' }
      );
      const floatEl = hero.querySelector('.float-slow');
      if (floatEl) {
        gsap.to(floatEl, { y: -8, duration: 2.2, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      }
    }

    // ScrollTrigger animations (desktop full, mobile lighter)
    if (ScrollTrigger && !isReduced()) {
      mm.add('(min-width: 768px)', () => {
        const reveals = gsap.utils.toArray('.reveal');
        reveals.forEach((el) => {
          el.classList.add('revealed');
          const delaySec = (Number(el.getAttribute('data-delay')) || 0) / 1000;
          gsap.fromTo(
            el,
            { opacity: 0, y: 24 },
            {
              opacity: 1,
              y: 0,
              duration: 0.48,
              delay: delaySec,
              ease: 'power2.out',
              clearProps: 'transform,opacity',
              scrollTrigger: { trigger: el, start: 'top 88%', once: true }
            }
          );
        });

        const heroVisual = document.querySelector('.lp-hero-visual');
        if (heroVisual && !isLowEnd()) {
          gsap.to(heroVisual, {
            y: 36,
            ease: 'none',
            scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom top', scrub: true }
          });
        }

        const stepLine = document.querySelector('.steps-connector-fill');
        if (stepLine) {
          gsap.fromTo(
            stepLine,
            { scaleX: 0.12 },
            {
              scaleX: 1,
              ease: 'none',
              scrollTrigger: { trigger: stepLine.parentElement, start: 'top 82%', end: 'top 35%', scrub: true }
            }
          );
        }
      });

      mm.add('(max-width: 767px)', () => {
        gsap.utils.toArray('.reveal').forEach((el) => {
          el.classList.add('revealed');
          gsap.fromTo(
            el,
            { opacity: 0, y: 12 },
            {
              opacity: 1,
              y: 0,
              duration: 0.34,
              ease: 'power2.out',
              clearProps: 'transform,opacity',
              scrollTrigger: { trigger: el, start: 'top 92%', once: true }
            }
          );
        });
      });

      // Number Counters via ScrollTrigger
      gsap.utils.toArray('[data-countup]').forEach((el) => {
        const target = Number(el.getAttribute('data-countup')) || 0;
        const suffix = el.getAttribute('data-suffix') || '';
        if (isLowEnd()) {
          el.textContent = `${target}${suffix}`;
          return;
        }
        const obj = { val: 0 };
        gsap.to(obj, {
          val: target,
          duration: 0.9,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          onUpdate: () => { el.textContent = `${Math.round(obj.val)}${suffix}`; }
        });
      });
    } else {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('revealed'));
    }

    // Pause when tab is hidden; clean up when leaving page
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        gsap.globalTimeline.pause();
        if (lenisInstance) lenisInstance.stop();
      } else {
        gsap.globalTimeline.resume();
        if (lenisInstance) lenisInstance.start();
      }
    });

    window.addEventListener('pagehide', () => {
      if (ScrollTrigger) ScrollTrigger.getAll().forEach((t) => t.kill());
      mm.revert();
      if (lenisInstance) {
        lenisInstance.destroy();
        lenisInstance = null;
      }
    });

    // Still keep progress bar + navbar solid/hide + back-to-top smooth via passive scroll listener
    let lastY = window.scrollY;
    let ticking = false;
    const lpNav = document.querySelector('.lp-nav');
    const onScroll = () => {
      const y = window.scrollY;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      bar.style.transform = `scaleX(${Math.min(1, y / maxScroll)})`;
      if (topBtn) topBtn.classList.toggle('visible', y > 300);
      if (lpNav) {
        lpNav.classList.toggle('lp-nav--solid', y > 24);
        lpNav.classList.toggle('lp-nav--hidden', y > 120 && y > lastY);
      }
      lastY = y;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();

    return true;
  }

  function initScrollAndMicroInteractions() {
    // Lazy pre-warm Lottie only on scoring page after initial load
    if (document.body.classList.contains('scoring-active') || window.location.pathname.includes('live-score')) {
      setTimeout(() => preloadLottie(), 1200);
    }

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
      topBtn.addEventListener('click', () => {
        if (lenisInstance) lenisInstance.scrollTo(0);
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      document.body.appendChild(topBtn);
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

    // Use GSAP + ScrollTrigger + Lenis when loaded, otherwise fall back cleanly to CSS + IO + rAF
    if (initGsapAndLenis(bar, topBtn)) return;

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
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();
  }

  document.addEventListener('DOMContentLoaded', initScrollAndMicroInteractions);

  root.ApnaAnimations = {
    shouldAnimate,
    animateCards,
    celebrate,
    pulseScore,
    shake,
    preloadLottie
  };
}(window));
