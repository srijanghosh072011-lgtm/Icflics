/* Icflic — contact form.
   Posts to /api/contact. User values are written with textContent only. */
(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  if (!form) return;

  var feedback = document.getElementById('contact-feedback');
  var submit = document.getElementById('c-submit');
  var renderedAt = Date.now();

  function clearErrors() {
    ['name', 'email', 'message'].forEach(function (key) {
      var el = document.getElementById('ce-' + key);
      if (el) { el.textContent = ''; el.classList.add('is-hidden'); }
      var input = document.getElementById('c-' + key);
      if (input) input.removeAttribute('aria-invalid');
    });
    feedback.textContent = '';
  }

  function showError(field, message) {
    var el = document.getElementById('ce-' + field);
    var input = document.getElementById('c-' + field);
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    if (el) { el.textContent = message; el.classList.remove('is-hidden'); }
  }

  function notice(kind, message) {
    feedback.textContent = '';
    var box = document.createElement('div');
    box.className = 'notice notice-' + kind;
    box.textContent = message;
    feedback.appendChild(box);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearErrors();

    var name = document.getElementById('c-name').value.trim();
    var email = document.getElementById('c-email').value.trim();
    var message = document.getElementById('c-message').value.trim();

    if (name.length < 2) { showError('name', 'Please enter your name.'); return; }
    if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email)) {
      showError('email', 'Please enter a valid email address.');
      return;
    }
    if (message.length < 10) {
      showError('message', 'Please add a little more detail.');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';

    fetch('/api/contact', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        message: message,
        website: document.getElementById('c-website').value,
        elapsed: Date.now() - renderedAt,
      }),
    })
      .then(function (response) {
        var type = response.headers.get('content-type') || '';
        if (!type.includes('application/json')) {
          var err = new Error('no-backend');
          err.noBackend = true;
          throw err;
        }
        return response.json();
      })
      .then(function (data) {
        if (!data.ok) {
          submit.disabled = false;
          submit.textContent = 'Send message';
          if (data.field) showError(data.field, data.error);
          notice('error', data.error || 'Something went wrong. Please try again.');
          return;
        }
        form.reset();
        submit.textContent = 'Sent';
        notice('ok', 'Message sent. You will get a reply within 48 hours.');
      })
      .catch(function (error) {
        submit.disabled = false;
        submit.textContent = 'Send message';
        if (error && error.noBackend) {
          notice('warn', 'This is a static preview, so the form is not connected. '
            + 'Email hello@icflic.com instead.');
          return;
        }
        notice('error',
          'The message could not be sent. Check your connection, or email hello@icflic.com.');
      });
  });
})();
