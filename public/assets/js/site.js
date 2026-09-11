/* Icflic — shared site behaviour.
   Progressive enhancement only: every page works with this file blocked. */
(function () {
  'use strict';

  /* ---- Mobile navigation ------------------------------------------------ */
  var toggle = document.querySelector('.nav-toggle');
  var drawer = document.getElementById('mobile-nav');

  if (toggle && drawer) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('data-open', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    drawer.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Reveal on scroll --------------------------------------------------
     Wrapped so its early returns end this behaviour only. Returning from the
     outer function here would have taken the thumb bar with it on any page
     without reveal targets, or for anyone using reduced motion. */

  (function revealOnScroll() {
    var targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    targets.forEach(function (el) { observer.observe(el); });
  })();

  /* ---- Thumb bar ---------------------------------------------------------
     A fixed booking action within thumb reach on phones. Injected rather than
     repeated in nine HTML files, and skipped where it would be noise: the
     booking page itself and the owner panel. */

  (function thumbBar() {
    var path = window.location.pathname.replace(/\/index\.html$/, '/');
    var onBooking = /\/book(\.html)?\/?$/.test(path);
    var onOwner = /\/owner\/?/.test(path);
    if (onBooking || onOwner) return;

    var bar = document.createElement('div');
    bar.className = 'thumb-bar';
    bar.setAttribute('data-show', 'false');

    var note = document.createElement('span');
    note.className = 'thumb-note';
    note.textContent = 'From $295';
    bar.appendChild(note);

    var cta = document.createElement('a');
    cta.className = 'btn';
    cta.href = '/book';
    cta.textContent = 'Check availability';
    bar.appendChild(cta);

    document.body.appendChild(bar);
    document.body.classList.add('has-thumb-bar');

    // Hold it back until the hero's own buttons have gone by, so the two are
    // never competing on screen at the same time.
    var trigger = document.querySelector('.hero-actions, .page-head');
    var show = false;

    var update = function () {
      var past = trigger
        ? trigger.getBoundingClientRect().bottom < 0
        : window.scrollY > window.innerHeight * 0.6;
      // Release it near the footer so it stops covering the real CTA.
      var atEnd = window.innerHeight + window.scrollY
        > document.body.scrollHeight - 220;
      var next = past && !atEnd;
      if (next === show) return;
      show = next;
      bar.setAttribute('data-show', String(show));
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
  })();

  /* ---- Swipe affordance --------------------------------------------------
     A scroll-snap rail looks like a cut-off grid unless something says it
     moves. Nudge it a few pixels the first time it comes into view. */

  (function swipeHint() {
    if (reduced || !('IntersectionObserver' in window)) return;
    var rails = document.querySelectorAll('.grid-3, .grid-4');
    if (!rails.length) return;

    var hinted = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var rail = entry.target;
        if (!entry.isIntersecting || hinted.has(rail)) return;
        if (rail.scrollWidth <= rail.clientWidth + 4) return;  // not scrollable
        hinted.add(rail);
        rail.scrollTo({ left: 26, behavior: 'smooth' });
        window.setTimeout(function () {
          rail.scrollTo({ left: 0, behavior: 'smooth' });
        }, 420);
      });
    }, { threshold: 0.5 });

    rails.forEach(function (rail) { io.observe(rail); });
  })();
})();
