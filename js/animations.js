/**
 * ApnaScore Animations & Celebrations (GSAP + CSS, respects prefers-reduced-motion & Outdoor Mode)
 */
(function (root) {
  'use strict';

  function shouldAnimate() {
    if (document.body.classList.contains('outdoor-mode')) return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function animateCards(selector = '.card, .kpi-card, .quick-action-card') {
    if (!shouldAnimate() || typeof root.gsap === 'undefined') return;
    const els = document.querySelectorAll(selector);
    if (!els.length) return;
    root.gsap.fromTo(
      els,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.32, stagger: 0.035, ease: 'power2.out', clearProps: 'transform,opacity' }
    );
  }

  function celebrate(text, variant = 'boundary') {
    if (!shouldAnimate()) return;
    const existing = document.querySelector('.celebration-banner');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = `celebration-banner ${variant}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1950);
  }

  root.ApnaAnimations = {
    shouldAnimate,
    animateCards,
    celebrate
  };
}(window));
