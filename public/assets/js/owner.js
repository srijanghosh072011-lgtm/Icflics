/* Icflic — owner panel.

   Every value that originated from a visitor (names, emails, messages) is
   inserted with textContent. There is no innerHTML anywhere in this file, so
   a hostile booking note cannot become script.

   The CSRF token lives in a closure variable only: never localStorage, never
   a global, so another script on the page cannot read it. */
(function () {
  'use strict';

  var csrf = null;
  var data = null;
  var filter = 'all';

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var signinView = document.getElementById('signin-view');
  var panelView = document.getElementById('panel-view');
  var signinForm = document.getElementById('signin-form');
  var signinFeedback = document.getElementById('signin-feedback');
  var signinSubmit = document.getElementById('signin-submit');
  var signOut = document.getElementById('sign-out');

  /* ---- tiny DOM helpers -------------------------------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function field(label, value) {
    var wrap = el('div');
    wrap.appendChild(el('dt', null, label));
    wrap.appendChild(el('dd', null, value || '—'));
    return wrap;
  }

  function status(node, kind, message) {
    node.textContent = message || '';
    node.className = 'inline-status';
    node.setAttribute('data-kind', kind);
    if (message) {
      window.setTimeout(function () {
        if (node.textContent === message) node.textContent = '';
      }, 4000);
    }
  }

  function notice(node, kind, message) {
    node.textContent = '';
    if (!message) return;
    var box = el('div', 'notice notice-' + kind, message);
    node.appendChild(box);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function minutesToTime(min) {
    return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  }

  function timeToMinutes(value) {
    var parts = /^(\d{2}):(\d{2})$/.exec(value || '');
    if (!parts) return null;
    return Number(parts[1]) * 60 + Number(parts[2]);
  }

  /* ---- API --------------------------------------------------------------- */

  function api(path, options) {
    var config = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    config.headers = Object.assign({}, config.headers);
    if (config.method && config.method !== 'GET') {
      config.headers['content-type'] = 'application/json';
      if (csrf) config.headers['x-csrf-token'] = csrf;
    }
    return fetch(path, config).then(function (response) {
      var type = response.headers.get('content-type') || '';
      if (!type.includes('application/json')) {
        // No Functions runtime behind this host.
        return { status: response.status, body: { ok: false, noBackend: true,
          error: 'This is a static preview. Sign-in needs the Cloudflare deployment.' } };
      }
      return response.json().then(function (body) {
        return { status: response.status, body: body };
      });
    });
  }

  /* ---- auth -------------------------------------------------------------- */

  function showPanel() {
    signinView.classList.add('is-hidden');
    panelView.classList.remove('is-hidden');
    signOut.classList.remove('is-hidden');
  }

  function showSignin() {
    panelView.classList.add('is-hidden');
    signinView.classList.remove('is-hidden');
    signOut.classList.add('is-hidden');
    csrf = null;
  }

  signinForm.addEventListener('submit', function (event) {
    event.preventDefault();
    notice(signinFeedback, '', '');
    signinSubmit.disabled = true;
    signinSubmit.textContent = 'Signing in…';

    api('/api/owner/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('o-email').value.trim(),
        password: document.getElementById('o-password').value,
      }),
    }).then(function (result) {
      signinSubmit.disabled = false;
      signinSubmit.textContent = 'Sign in';
      if (!result.body.ok) {
        notice(signinFeedback, 'error', result.body.error || 'Sign-in failed.');
        return;
      }
      csrf = result.body.csrf;
      document.getElementById('o-password').value = '';
      showPanel();
      loadState();
    }).catch(function () {
      signinSubmit.disabled = false;
      signinSubmit.textContent = 'Sign in';
      notice(signinFeedback, 'error', 'Could not reach the server. Check your connection.');
    });
  });

  signOut.addEventListener('click', function () {
    api('/api/owner/logout', { method: 'POST' }).then(showSignin).catch(showSignin);
  });

  /* ---- load -------------------------------------------------------------- */

  function loadState() {
    return api('/api/owner/state').then(function (result) {
      if (result.status === 401) { showSignin(); return; }
      if (!result.body.ok) return;
      data = result.body;
      renderAll();
    });
  }

  function renderAll() {
    renderSummary();
    renderSettings();
    renderBookings();
    renderBlackouts();
    renderHours();
    renderMessages();
  }

  function renderSummary() {
    var pending = data.bookings.filter(function (b) { return b.status === 'pending'; }).length;
    var confirmed = data.bookings.filter(function (b) { return b.status === 'confirmed'; }).length;
    var unread = data.messages.filter(function (m) { return !m.handled; }).length;

    document.getElementById('panel-summary').textContent =
      pending + ' pending, ' + confirmed + ' confirmed, ' + unread + ' unread message'
      + (unread === 1 ? '' : 's') + '.';

    document.getElementById('panel-footnote').textContent =
      'All times in ' + String(data.timezone).replace(/_/g, ' ')
      + '. Sessions are ' + data.slotMinutes + ' minutes.';
  }

  /* ---- settings ---------------------------------------------------------- */

  function renderSettings() {
    var toggle = document.getElementById('booking-toggle');
    toggle.checked = data.settings.bookingEnabled;
    document.getElementById('paused-message').value = data.settings.pausedMessage;
    updateSwitchCaption();
  }

  function updateSwitchCaption() {
    var on = document.getElementById('booking-toggle').checked;
    document.getElementById('switch-caption').textContent = on
      ? 'The calendar is live and accepting requests.'
      : 'The calendar is hidden. Visitors see your message instead.';
  }

  document.getElementById('booking-toggle').addEventListener('change', updateSwitchCaption);

  document.getElementById('save-settings').addEventListener('click', function () {
    var node = document.getElementById('settings-feedback');
    api('/api/owner/settings', {
      method: 'POST',
      body: JSON.stringify({
        bookingEnabled: document.getElementById('booking-toggle').checked,
        pausedMessage: document.getElementById('paused-message').value,
      }),
    }).then(function (result) {
      if (!result.body.ok) { status(node, 'error', result.body.error || 'Could not save.'); return; }
      status(node, 'ok', 'Saved.');
      data.settings.bookingEnabled = result.body.bookingEnabled;
      data.settings.pausedMessage = result.body.pausedMessage;
    }).catch(function () { status(node, 'error', 'Could not reach the server.'); });
  });

  /* ---- bookings ---------------------------------------------------------- */

  function bookingRecord(booking) {
    var record = el('article', 'record');
    record.setAttribute('data-status', booking.status);

    var head = el('div', 'record-head');
    head.appendChild(el('p', 'record-when', booking.label));
    var right = el('div', 'cluster');
    right.appendChild(el('span', 'status-pill status-' + booking.status, booking.status));
    right.appendChild(el('span', 'record-ref', booking.reference));
    head.appendChild(right);
    record.appendChild(head);

    var grid = el('dl', 'record-grid');
    grid.appendChild(field('Name', booking.name));
    grid.appendChild(field('Email', booking.email));
    grid.appendChild(field('Phone', booking.phone));
    grid.appendChild(field('Sport', booking.sport));
    grid.appendChild(field('Package', booking.package_id));
    grid.appendChild(field('Location', booking.location));
    record.appendChild(grid);

    if (booking.message) {
      record.appendChild(el('p', 'record-note', booking.message));
    }

    var actions = el('div', 'record-actions');

    if (booking.status !== 'confirmed') {
      actions.appendChild(actionButton('Confirm', 'btn btn-sm', booking.id, 'confirmed'));
    }
    if (booking.status !== 'declined') {
      actions.appendChild(actionButton('Decline', 'btn btn-sm btn-ghost', booking.id, 'declined'));
    }
    if (booking.status !== 'cancelled') {
      actions.appendChild(actionButton('Cancel', 'btn btn-sm btn-ghost', booking.id, 'cancelled'));
    }

    var mail = el('a', 'link-line', 'Email them');
    mail.href = 'mailto:' + encodeURIComponent(booking.email)
      + '?subject=' + encodeURIComponent('Your Icflic booking ' + booking.reference);
    actions.appendChild(mail);

    record.appendChild(actions);
    return record;
  }

  function actionButton(label, className, id, newStatus) {
    var button = el('button', className, label);
    button.type = 'button';
    button.addEventListener('click', function () {
      button.disabled = true;
      api('/api/owner/booking', {
        method: 'POST',
        body: JSON.stringify({ id: id, status: newStatus }),
      }).then(function (result) {
        if (!result.body.ok) { button.disabled = false; return; }
        loadState();
      }).catch(function () { button.disabled = false; });
    });
    return button;
  }

  function renderBookings() {
    var list = document.getElementById('bookings-list');
    list.textContent = '';

    var rows = data.bookings.filter(function (b) {
      return filter === 'all' || b.status === filter;
    });

    if (!rows.length) {
      list.appendChild(el('p', 'empty-state',
        filter === 'all'
          ? 'No booking requests yet. They appear here the moment one lands.'
          : 'Nothing with that status right now.'));
      return;
    }

    rows.forEach(function (booking) { list.appendChild(bookingRecord(booking)); });
  }

  document.querySelectorAll('.chip[data-filter]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.getAttribute('data-filter');
      document.querySelectorAll('.chip[data-filter]').forEach(function (other) {
        other.classList.toggle('is-active', other === chip);
      });
      renderBookings();
    });
  });

  /* ---- blackouts --------------------------------------------------------- */

  function renderBlackouts() {
    var list = document.getElementById('blackouts-list');
    list.textContent = '';

    if (!data.blackouts.length) {
      list.appendChild(el('p', 'empty-state',
        'Nothing blocked. Add a window above to take time off the calendar.'));
      return;
    }

    data.blackouts.forEach(function (blackout) {
      var record = el('article', 'record');
      var head = el('div', 'record-head');
      head.appendChild(el('p', 'record-when', blackout.startLabel + '  →  ' + blackout.endLabel));
      head.appendChild(el('span', 'record-ref', 'Blocked'));
      record.appendChild(head);

      if (blackout.reason) record.appendChild(el('p', 'record-note', blackout.reason));

      var actions = el('div', 'record-actions');
      var remove = el('button', 'btn btn-sm btn-ghost', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        remove.disabled = true;
        api('/api/owner/blackout', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', id: blackout.id }),
        }).then(loadState).catch(function () { remove.disabled = false; });
      });
      actions.appendChild(remove);
      record.appendChild(actions);
      list.appendChild(record);
    });
  }

  document.getElementById('add-blackout').addEventListener('click', function () {
    var node = document.getElementById('blackout-feedback');
    var startDate = document.getElementById('b-start-date').value;
    var endDate = document.getElementById('b-end-date').value || startDate;

    if (!startDate) { status(node, 'error', 'Pick a start date.'); return; }

    api('/api/owner/blackout', {
      method: 'POST',
      body: JSON.stringify({
        action: 'add',
        startDate: startDate,
        endDate: endDate,
        startTime: document.getElementById('b-start-time').value,
        endTime: document.getElementById('b-end-time').value,
        reason: document.getElementById('b-reason').value,
      }),
    }).then(function (result) {
      if (!result.body.ok) { status(node, 'error', result.body.error || 'Could not save.'); return; }
      status(node, 'ok', result.body.clashes
        ? 'Blocked — note ' + result.body.clashes + ' existing booking(s) fall inside it.'
        : 'Blocked.');
      document.getElementById('b-reason').value = '';
      loadState();
    }).catch(function () { status(node, 'error', 'Could not reach the server.'); });
  });

  /* ---- weekly hours ------------------------------------------------------ */

  function hoursRow(rule) {
    var row = el('div', 'hours-row');

    var day = el('select', 'select');
    DAY_NAMES.forEach(function (label, index) {
      var option = el('option', null, label);
      option.value = String(index);
      day.appendChild(option);
    });
    day.value = String(rule ? rule.weekday : 6);
    day.setAttribute('data-role', 'weekday');
    day.setAttribute('aria-label', 'Day of the week');
    row.appendChild(day);

    var from = el('input', 'input');
    from.type = 'time';
    from.step = '900';
    from.value = minutesToTime(rule ? rule.start_min : 540);
    from.setAttribute('data-role', 'start');
    from.setAttribute('aria-label', 'Start time');
    row.appendChild(from);

    var to = el('input', 'input');
    to.type = 'time';
    to.step = '900';
    to.value = minutesToTime(rule ? rule.end_min : 1140);
    to.setAttribute('data-role', 'end');
    to.setAttribute('aria-label', 'End time');
    row.appendChild(to);

    var remove = el('button', 'btn btn-sm btn-ghost', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      row.remove();
      if (!document.querySelectorAll('#hours-list .hours-row').length) showHoursEmpty();
    });
    row.appendChild(remove);

    return row;
  }

  function showHoursEmpty() {
    var list = document.getElementById('hours-list');
    if (list.querySelector('.empty-state')) return;
    list.appendChild(el('p', 'empty-state',
      'No hours set. With nothing here the calendar has no slots to offer.'));
  }

  /**
   * A flat list of windows rather than one row per weekday.
   * Days can carry more than one window — a morning and an evening block, say —
   * and the engine already honours that. Rendering one row per day meant the
   * extra windows were invisible here and were deleted on the next save.
   */
  function renderHours() {
    var list = document.getElementById('hours-list');
    list.textContent = '';

    var rules = (data.rules || [])
      .filter(function (r) { return r.active; })
      .slice()
      .sort(function (a, b) { return a.weekday - b.weekday || a.start_min - b.start_min; });

    if (!rules.length) {
      showHoursEmpty();
      return;
    }
    rules.forEach(function (rule) { list.appendChild(hoursRow(rule)); });
  }

  document.getElementById('add-hours').addEventListener('click', function () {
    var list = document.getElementById('hours-list');
    var empty = list.querySelector('.empty-state');
    if (empty) empty.remove();
    var row = hoursRow(null);
    list.appendChild(row);
    row.querySelector('[data-role="weekday"]').focus();
  });

  document.getElementById('save-hours').addEventListener('click', function () {
    var node = document.getElementById('hours-feedback');
    var rules = [];
    var rows = document.querySelectorAll('#hours-list .hours-row');

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var weekday = Number(row.querySelector('[data-role="weekday"]').value);
      var startMin = timeToMinutes(row.querySelector('[data-role="start"]').value);
      var endMin = timeToMinutes(row.querySelector('[data-role="end"]').value);
      var dayName = DAY_NAMES[weekday];

      if (startMin === null || endMin === null) {
        status(node, 'error', dayName + ' needs both a start and an end time.');
        return;
      }
      if (endMin <= startMin) {
        status(node, 'error', dayName + ' must end after it starts.');
        return;
      }
      rules.push({ weekday: weekday, start_min: startMin, end_min: endMin, active: true });
    }

    // Overlapping windows on the same day would produce duplicate slots.
    for (var a = 0; a < rules.length; a++) {
      for (var b = a + 1; b < rules.length; b++) {
        if (rules[a].weekday !== rules[b].weekday) continue;
        if (rules[a].start_min < rules[b].end_min && rules[b].start_min < rules[a].end_min) {
          status(node, 'error', 'Two ' + DAY_NAMES[rules[a].weekday] + ' windows overlap.');
          return;
        }
      }
    }

    api('/api/owner/availability', {
      method: 'POST',
      body: JSON.stringify({ rules: rules }),
    }).then(function (result) {
      if (!result.body.ok) { status(node, 'error', result.body.error || 'Could not save.'); return; }
      status(node, 'ok', rules.length
        ? 'Saved ' + rules.length + ' window' + (rules.length === 1 ? '' : 's') + '.'
        : 'Saved. The calendar now has no open hours.');
      loadState();
    }).catch(function () { status(node, 'error', 'Could not reach the server.'); });
  });

  /* ---- messages ---------------------------------------------------------- */

  function renderMessages() {
    var list = document.getElementById('messages-list');
    list.textContent = '';

    if (!data.messages.length) {
      list.appendChild(el('p', 'empty-state', 'No messages yet.'));
      return;
    }

    data.messages.forEach(function (message) {
      var record = el('article', 'record');
      record.setAttribute('data-status', message.handled ? 'cancelled' : 'pending');

      var head = el('div', 'record-head');
      head.appendChild(el('p', 'record-when', message.name));
      head.appendChild(el('span', 'record-ref',
        new Date(message.created_at * 1000).toLocaleDateString(undefined, {
          day: 'numeric', month: 'short', year: 'numeric',
        })));
      record.appendChild(head);

      var grid = el('dl', 'record-grid');
      grid.appendChild(field('Email', message.email));
      record.appendChild(grid);
      record.appendChild(el('p', 'record-note', message.body));

      var actions = el('div', 'record-actions');

      var toggle = el('button', 'btn btn-sm btn-ghost',
        message.handled ? 'Mark unread' : 'Mark handled');
      toggle.type = 'button';
      toggle.addEventListener('click', function () {
        toggle.disabled = true;
        api('/api/owner/message', {
          method: 'POST',
          body: JSON.stringify({ action: 'handled', id: message.id, handled: !message.handled }),
        }).then(loadState).catch(function () { toggle.disabled = false; });
      });
      actions.appendChild(toggle);

      var reply = el('a', 'link-line', 'Reply');
      reply.href = 'mailto:' + encodeURIComponent(message.email);
      actions.appendChild(reply);

      record.appendChild(actions);
      list.appendChild(record);
    });
  }

  /* ---- tabs -------------------------------------------------------------- */

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (other) {
        var selected = other === tab;
        other.setAttribute('aria-selected', String(selected));
        document.getElementById(other.getAttribute('aria-controls'))
          .classList.toggle('is-hidden', !selected);
      });
    });
  });

  /* ---- boot -------------------------------------------------------------- */

  // An existing cookie means the session survived a reload; the server hands
  // back a fresh CSRF token rather than the client persisting one.
  api('/api/owner/session').then(function (result) {
    if (result.body && result.body.ok) {
      csrf = result.body.csrf;
      showPanel();
      loadState();
    } else {
      showSignin();
    }
  }).catch(showSignin);
})();
