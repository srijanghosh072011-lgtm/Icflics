/* Icflic — booking calendar.
   Renders real availability from /api/availability and submits to /api/bookings.
   All user-supplied values are written with textContent, never innerHTML. */
(function () {
  'use strict';

  var form = document.getElementById('booking-form');
  if (!form) return;

  var grid = document.getElementById('cal-grid');
  var title = document.getElementById('cal-title');
  var status = document.getElementById('cal-status');
  var prev = document.getElementById('cal-prev');
  var next = document.getElementById('cal-next');
  var slotList = document.getElementById('slot-list');
  var timeWrap = document.getElementById('step-time-wrap');
  var detailWrap = document.getElementById('step-details-wrap');
  var feedback = document.getElementById('form-feedback');
  var submit = document.getElementById('f-submit');
  var closedBox = document.getElementById('booking-closed');
  var closedMsg = document.getElementById('booking-closed-message');
  var successBox = document.getElementById('booking-success');

  var state = {
    month: null,          // Date pinned to the 1st of the month on display
    days: {},             // "YYYY-MM-DD" -> ["09:00", ...]
    selectedDate: null,
    selectedTime: null,
    slotMinutes: 90,
    timezone: '',
    loading: false,
    renderedAt: Date.now(),
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---- helpers ---------------------------------------------------------- */

  function pad(n) { return String(n).padStart(2, '0'); }

  function isoOf(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function humanDate(iso) {
    var parts = iso.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function humanTime(hhmm) {
    var parts = hhmm.split(':');
    var d = new Date(2000, 0, 1, Number(parts[0]), Number(parts[1]));
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function showFeedback(kind, message) {
    feedback.textContent = '';
    if (!message) return;
    var box = document.createElement('div');
    box.className = 'notice notice-' + kind;
    box.textContent = message;
    feedback.appendChild(box);
  }

  function clearFieldErrors() {
    ['name', 'email', 'date'].forEach(function (key) {
      var el = document.getElementById('e-' + key);
      if (el) { el.textContent = ''; el.classList.add('is-hidden'); }
      var input = document.getElementById('f-' + key);
      if (input) input.removeAttribute('aria-invalid');
    });
  }

  function showFieldError(field, message) {
    var el = document.getElementById('e-' + field);
    var input = document.getElementById('f-' + field);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    if (el) {
      el.textContent = message;
      el.classList.remove('is-hidden');
    }
  }

  /* ---- data ------------------------------------------------------------- */

  function rangeFor(month) {
    var first = new Date(month.getFullYear(), month.getMonth(), 1);
    var last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (first < today) first = today;
    return { from: isoOf(first), to: isoOf(last) };
  }

  function load(month) {
    state.loading = true;
    status.textContent = 'Loading availability…';
    var range = rangeFor(month);

    return fetch('/api/availability?from=' + range.from + '&to=' + range.to, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (response) {
        // A static host has no Functions runtime, so this path returns the
        // 404 page rather than JSON. Say that plainly instead of failing.
        var type = response.headers.get('content-type') || '';
        if (!type.includes('application/json')) {
          var err = new Error('no-backend');
          err.noBackend = true;
          throw err;
        }
        return response.json();
      })
      .then(function (data) {
        state.loading = false;
        if (!data.ok) throw new Error(data.error || 'Failed');

        state.timezone = data.timezone || '';
        state.slotMinutes = data.slotMinutes || 90;
        setText('s-tz', state.timezone.replace(/_/g, ' '));

        if (data.enabled === false) {
          closedMsg.textContent = data.message || '';
          closedBox.classList.remove('is-hidden');
          form.classList.add('is-hidden');
          // The intro promises a calendar. There isn't one right now.
          var intro = document.getElementById('book-intro');
          if (intro) {
            intro.textContent =
              'The booking calendar is paused at the moment. Here is what to do instead.';
          }
          return;
        }

        state.days = data.days || {};
        render();
      })
      .catch(function (error) {
        state.loading = false;
        if (error && error.noBackend) {
          closedMsg.textContent = 'This is a static preview of the site, so the live '
            + 'calendar is not connected. On the real deployment this shows genuine '
            + 'availability and takes bookings.';
          closedBox.classList.remove('is-hidden');
          form.classList.add('is-hidden');
          var intro = document.getElementById('book-intro');
          if (intro) intro.textContent = 'A preview of the booking page.';
          return;
        }
        status.textContent =
          'Availability could not be loaded. Please reload, or email hello@icflic.com.';
      });
  }

  /* ---- rendering -------------------------------------------------------- */

  function render() {
    var month = state.month;
    title.textContent = MONTHS[month.getMonth()] + ' ' + month.getFullYear();

    grid.textContent = '';
    var firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    var daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    var todayIso = isoOf(new Date());

    for (var blank = 0; blank < firstWeekday; blank++) {
      var filler = document.createElement('span');
      filler.className = 'cal-day is-empty';
      filler.setAttribute('aria-hidden', 'true');
      grid.appendChild(filler);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var iso = month.getFullYear() + '-' + pad(month.getMonth() + 1) + '-' + pad(day);
      var slots = state.days[iso] || [];
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day';
      cell.textContent = String(day);
      cell.dataset.date = iso;

      if (iso === todayIso) cell.classList.add('is-today');

      if (slots.length) {
        cell.classList.add('is-open');
        cell.setAttribute('aria-pressed', String(state.selectedDate === iso));
        cell.setAttribute('aria-label',
          humanDate(iso) + ' — ' + slots.length + ' slot' + (slots.length > 1 ? 's' : '') + ' open');
      } else {
        cell.disabled = true;
        cell.setAttribute('aria-label', humanDate(iso) + ' — unavailable');
      }

      grid.appendChild(cell);
    }

    var open = Object.keys(state.days).filter(function (iso) {
      return sameMonth(new Date(iso + 'T12:00:00'), month);
    }).length;

    status.textContent = open
      ? open + ' date' + (open > 1 ? 's' : '') + ' open this month. Times shown in '
        + state.timezone.replace(/_/g, ' ') + '.'
      : 'Nothing open this month — try the next one.';

    prev.disabled = sameMonth(month, startOfMonth(new Date()));
  }

  function renderSlots() {
    slotList.textContent = '';
    var slots = state.days[state.selectedDate] || [];

    slots.forEach(function (hhmm) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.textContent = humanTime(hhmm);
      button.dataset.time = hhmm;
      button.setAttribute('aria-pressed', String(state.selectedTime === hhmm));
      slotList.appendChild(button);
    });

    timeWrap.classList.toggle('is-hidden', slots.length === 0);
  }

  function updateSummary() {
    setText('s-date', state.selectedDate ? humanDate(state.selectedDate) : '—');
    setText('s-time', state.selectedTime ? humanTime(state.selectedTime) : '—');
    setText('s-length', state.selectedTime ? state.slotMinutes + ' minutes' : '—');
    var select = document.getElementById('f-package');
    var label = select && select.selectedIndex >= 0
      ? select.options[select.selectedIndex].textContent : '';
    setText('s-package', label || 'Not chosen');
  }

  /* ---- events ----------------------------------------------------------- */

  grid.addEventListener('click', function (event) {
    var cell = event.target.closest('.cal-day');
    if (!cell || cell.disabled || !cell.dataset.date) return;

    state.selectedDate = cell.dataset.date;
    state.selectedTime = null;

    grid.querySelectorAll('.cal-day.is-open').forEach(function (el) {
      el.setAttribute('aria-pressed', String(el.dataset.date === state.selectedDate));
    });

    renderSlots();
    updateSummary();
    detailWrap.classList.add('is-hidden');
    timeWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  slotList.addEventListener('click', function (event) {
    var button = event.target.closest('.slot');
    if (!button) return;

    state.selectedTime = button.dataset.time;
    slotList.querySelectorAll('.slot').forEach(function (el) {
      el.setAttribute('aria-pressed', String(el.dataset.time === state.selectedTime));
    });

    updateSummary();
    detailWrap.classList.remove('is-hidden');
    detailWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  prev.addEventListener('click', function () {
    if (state.loading) return;
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    load(state.month);
  });

  next.addEventListener('click', function () {
    if (state.loading) return;
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    load(state.month);
  });

  var packageSelect = document.getElementById('f-package');
  if (packageSelect) packageSelect.addEventListener('change', updateSummary);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearFieldErrors();
    showFeedback('', '');

    if (!state.selectedDate || !state.selectedTime) {
      showFeedback('warn', 'Pick a date and time first.');
      return;
    }

    var name = document.getElementById('f-name').value.trim();
    var email = document.getElementById('f-email').value.trim();

    if (name.length < 2) {
      showFieldError('name', 'Please enter your name.');
      return;
    }
    if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email)) {
      showFieldError('email', 'Please enter a valid email address.');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';

    fetch('/api/bookings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: document.getElementById('f-phone').value.trim(),
        sport: document.getElementById('f-sport').value.trim(),
        package: document.getElementById('f-package').value,
        location: document.getElementById('f-location').value.trim(),
        message: document.getElementById('f-message').value.trim(),
        date: state.selectedDate,
        time: state.selectedTime,
        website: document.getElementById('f-website').value,
        elapsed: Date.now() - state.renderedAt,
      }),
    })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data.ok) {
          submit.disabled = false;
          submit.textContent = 'Send booking request';
          if (data.field) {
            showFieldError(data.field, data.error);
            if (data.field === 'date') load(state.month);
          }
          showFeedback('error', data.error || 'Something went wrong. Please try again.');
          return;
        }

        setText('success-ref', data.reference || '');
        form.classList.add('is-hidden');
        successBox.classList.remove('is-hidden');
        successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () {
        submit.disabled = false;
        submit.textContent = 'Send booking request';
        showFeedback('error',
          'The request could not be sent. Check your connection, or email hello@icflic.com.');
      });
  });

  /* ---- boot ------------------------------------------------------------- */

  state.month = startOfMonth(new Date());
  updateSummary();
  load(state.month);
})();
