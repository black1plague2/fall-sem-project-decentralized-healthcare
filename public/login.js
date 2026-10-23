/* Cardano Healthcare Vault — actor sign-in */
(function () {
  'use strict';

  var NAMES = { '01': 'Patient', '02': 'Doctor', '03': 'Hospital', '04': 'Insurance' };
  var params = new URLSearchParams(location.search);
  // Only same-site relative paths are allowed as a return target.
  var next = params.get('next');
  if (!next || next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/dashboard';

  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function injectIcons() {
    if (!window.VaultIcons) return;
    $all('[data-icon]').forEach(function (n) {
      n.innerHTML = window.VaultIcons.icon(n.dataset.icon, { size: n.classList.contains('role__glyph') ? 18 : 16 });
    });
  }

  function pickRole(btn) {
    $all('.role').forEach(function (r) { r.setAttribute('aria-checked', String(r === btn)); });
    var user = $('#username');
    user.value = btn.dataset.role;
    $('#password').value = '';
    $('#loginBtn').textContent = 'Sign in as ' + NAMES[btn.dataset.actor];
    hideError();
    $('#password').focus();
  }

  function showError(msg) { var e = $('#loginError'); e.textContent = msg; e.hidden = false; }
  function hideError() { var e = $('#loginError'); e.hidden = true; e.textContent = ''; }

  function renderSigned(actors) {
    $all('.role').forEach(function (r) { r.classList.toggle('is-signed', actors.indexOf(r.dataset.actor) !== -1); });
    var block = $('#signedBlock');
    if (!actors.length) { block.hidden = true; return; }
    block.hidden = false;
    $('#signedList').textContent = actors.map(function (a) { return NAMES[a]; }).join(', ');
    $('#continueBtn').setAttribute('href', next);
  }

  async function refreshSession() {
    try {
      var res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      var data = await res.json();
      if (!data.configured) showError('Sign-in is not configured on this server yet.');
      $('#demoAccess').hidden = !data.demoLogin;
      renderSigned(data.actors || []);
      return data.actors || [];
    } catch (e) { return []; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectIcons();
    $all('.role').forEach(function (btn) { btn.addEventListener('click', function () { pickRole(btn); }); });

    // ?role=doctor preselects a role (used by the dashboard's "sign in as" links)
    var wanted = params.get('role');
    var pre = wanted && $('.role[data-role="' + wanted.replace(/[^a-z]/g, '') + '"]');
    if (pre) pickRole(pre); else $('#username').focus();

    $('#pwToggle').addEventListener('click', function () {
      var pw = $('#password');
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      this.textContent = show ? 'Hide' : 'Show';
      this.setAttribute('aria-pressed', String(show));
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    $('#loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      hideError();
      var username = $('#username').value.trim();
      var password = $('#password').value;
      if (!username || !password) { showError('Enter your username and password.'); return; }
      var btn = $('#loginBtn');
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Checking…';
      try {
        var res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.error || 'Sign-in failed.');
        $('#password').value = '';
        // Straight back to where the user came from unless they are adding more actors.
        if (params.get('stay') === '1') {
          renderSigned(data.actors || []);
          btn.textContent = label;
        } else {
          location.assign(next);
        }
      } catch (err) {
        showError(err.message);
        btn.textContent = label;
        $('#password').select();
      } finally {
        btn.disabled = false;
      }
    });

    $all('[data-demo-role]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        hideError();
        $all('[data-demo-role]').forEach(function (b) { b.disabled = true; });
        try {
          var res = await fetch('/api/auth/demo-login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: btn.dataset.demoRole }),
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.error || 'Demo sign-in failed.');
          location.assign(next);
        } catch (err) {
          showError(err.message);
          $all('[data-demo-role]').forEach(function (b) { b.disabled = false; });
        }
      });
    });

    $('#logoutAll').addEventListener('click', async function () {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      renderSigned([]);
    });

    refreshSession();
  });
})();
