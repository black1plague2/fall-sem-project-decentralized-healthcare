/* Decentralized Healthcare — guided demo (presenter mode)
 *
 * Runs every feature of the project end to end across the four separate
 * actor portals, which are loaded side by side as real pages. Each step
 * explains the idea behind it, performs it in the acting portal by calling
 * the same functions that portal's buttons call (window.VaultDash inside the
 * frame), and then checks the outcome against the server. The checks are
 * collected into a pass/fail list, so the demo doubles as an end-to-end test.
 */
(function () {
  'use strict';

  var ROLES = ['patient', 'doctor', 'hospital', 'insurance'];
  var ID = { patient: '01', doctor: '02', hospital: '03', insurance: '04' };
  var NAME = { patient: 'Patient', doctor: 'Doctor', hospital: 'Hospital', insurance: 'Insurance' };
  var ICON = { patient: 'user', doctor: 'stethoscope', hospital: 'building2', insurance: 'umbrella' };
  var READ_MS = 5200;   // narration stays up this long before and after each action
  var GAP = 12;

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function icon(name, size) { return window.VaultIcons ? window.VaultIcons.icon(name, { size: size || 16 }) : ''; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function injectIcons(root) {
    $all('[data-icon]', root).forEach(function (n) { n.innerHTML = icon(n.dataset.icon, n.closest('.frame__placeholder') ? 28 : 16); });
  }

  // ---------------------------------------------------------------
  // Frames and layout
  // ---------------------------------------------------------------
  var frames = {};
  ROLES.forEach(function (r) {
    var el = $('.frame[data-role="' + r + '"]');
    frames[r] = { el: el, iframe: $('iframe', el), state: $('[data-state]', el) };
  });
  var active = null;

  function layout() {
    var stage = $('#stage');
    var W = stage.clientWidth, H = stage.clientHeight;
    var rects = {};
    if (!active) {
      var w = (W - GAP * 3) / 2, h = (H - GAP * 3) / 2;
      ROLES.forEach(function (r, i) {
        rects[r] = { left: GAP + (i % 2) * (w + GAP), top: GAP + Math.floor(i / 2) * (h + GAP), width: w, height: h };
      });
    } else {
      var mainW = Math.round((W - GAP * 3) * 0.74);
      var railW = W - GAP * 3 - mainW;
      var others = ROLES.filter(function (r) { return r !== active; });
      var rh = (H - GAP * 4) / 3;
      rects[active] = { left: GAP, top: GAP, width: mainW, height: H - GAP * 2 };
      others.forEach(function (r, i) { rects[r] = { left: GAP * 2 + mainW, top: GAP + i * (rh + GAP), width: railW, height: rh }; });
    }
    ROLES.forEach(function (r) {
      var f = frames[r], rc = rects[r];
      f.el.style.left = rc.left + 'px'; f.el.style.top = rc.top + 'px';
      f.el.style.width = rc.width + 'px'; f.el.style.height = rc.height + 'px';
      var vw = rc.width - 4, vh = rc.height - 4 - 31;
      var scale = vw / 1440;
      f.iframe.style.transform = 'scale(' + scale + ')';
      f.iframe.style.height = Math.max(600, vh / scale) + 'px';
      f.el.classList.toggle('is-active', r === active);
      f.el.classList.toggle('is-dim', !!active && r !== active);
    });
  }
  function focus(role) { active = role; layout(); }
  window.addEventListener('resize', layout);

  function dash(role) {
    var w = frames[role].iframe.contentWindow;
    if (!w || !w.VaultDash) throw new Error('The ' + NAME[role] + ' portal is not loaded');
    return w.VaultDash;
  }
  function frameDoc(role) { return frames[role].iframe.contentWindow.document; }

  function loadPortal(role) {
    return new Promise(function (resolve, reject) {
      var f = frames[role];
      var timer = setTimeout(function () { reject(new Error('The ' + NAME[role] + ' portal did not load')); }, 20000);
      f.iframe.onload = function () {
        // Wait for the portal to finish booting (navigation built, session confirmed).
        var tries = 0;
        (function ready() {
          try {
            var d = f.iframe.contentWindow.document;
            if (f.iframe.contentWindow.location.pathname !== '/portal/' + role) {
              clearTimeout(timer);
              return reject(new Error('The ' + NAME[role] + ' portal sent us to sign in instead'));
            }
            if (d.querySelector('#dashNav .dash-nav__item') && f.iframe.contentWindow.VaultDash) {
              clearTimeout(timer);
              f.el.classList.add('is-live');
              f.state.textContent = 'signed in';
              return resolve();
            }
          } catch (e) { /* not ready */ }
          if (++tries > 200) { clearTimeout(timer); return reject(new Error('The ' + NAME[role] + ' portal did not start')); }
          setTimeout(ready, 100);
        })();
      };
      f.iframe.src = '/portal/' + role + '?embed=1&t=' + Date.now();
    });
  }

  // ---------------------------------------------------------------
  // Talking to the server directly (for the checks)
  // ---------------------------------------------------------------
  async function call(role, path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'X-Acting-As': ID[role] }, opts.headers || {});
    var res = await fetch(path, opts);
    var body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, ok: res.ok, body: body };
  }

  // ---------------------------------------------------------------
  // Pacing: pause, skip and stop
  // ---------------------------------------------------------------
  var run = null; // { paused, skip }
  function Stopped() {}
  function wait(ms) {
    var my = run;
    return new Promise(function (resolve, reject) {
      var left = ms, last = Date.now();
      (function tick() {
        if (!run || run !== my) return reject(new Stopped());
        var now = Date.now();
        if (!run.paused) left -= now - last;
        last = now;
        if (run.skip) { run.skip = false; return resolve(); }
        if (left <= 0) return resolve();
        setTimeout(tick, 60);
      })();
    });
  }
  async function untilResumed() { while (run && run.paused) await wait(150); if (!run) throw new Stopped(); }

  // ---------------------------------------------------------------
  // Narration panel
  // ---------------------------------------------------------------
  var results = [];
  function narrate(step, i, total) {
    $('#progressBar').style.width = Math.round((i / total) * 100) + '%';
    $('#stepCount').textContent = 'Step ' + i + ' of ' + total;
    var actor = $('#stepActor');
    if (step.role) {
      actor.hidden = false;
      actor.className = 'narr__actor icon-badge--' + step.role;
      actor.innerHTML = icon(ICON[step.role], 14) + ' ' + NAME[step.role] + ' portal';
    } else { actor.hidden = true; }
    $('#stepTitle').textContent = step.title;
    $('#stepTheory').innerHTML = step.theory.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    var watch = $('#stepWatch');
    if (step.watch) { watch.hidden = false; watch.innerHTML = '<b>Watch:</b> ' + step.watch; } else { watch.hidden = true; }
    setCheck('running', step.action ? 'Running…' : null);
  }
  function setCheck(kind, text) {
    var c = $('#stepCheck');
    if (!text) { c.hidden = true; return; }
    c.hidden = false;
    c.className = 'narr__check is-' + kind;
    c.innerHTML = (kind === 'pass' ? icon('checkCircle2', 18) : kind === 'fail' ? icon('xCircle', 18) : icon('loader', 18)) + '<span>' + esc(text) + '</span>';
  }
  function record(name, pass, detail) {
    results.push({ name: name, pass: pass, detail: detail });
    var list = $('#results');
    list.hidden = false;
    if (!$('.results__head', list)) list.innerHTML = '<li class="results__head">End-to-end checks</li>';
    var li = document.createElement('li');
    li.className = pass ? 'is-pass' : 'is-fail';
    li.innerHTML = icon(pass ? 'checkCircle2' : 'xCircle', 14) + '<span>' + esc(name) + (pass ? '' : ' — ' + esc(detail || 'failed')) + '</span>';
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }
  function expect(name, cond, detail) {
    record(name, !!cond, detail);
    if (!cond) throw new Error(name + (detail ? ': ' + detail : ''));
  }

  // ---------------------------------------------------------------
  // Synthetic medical file
  // ---------------------------------------------------------------
  var ctx = {};
  function syntheticReport(win) {
    var id = 'PT-' + (2000 + Math.floor(Math.random() * 7999));
    var text = [
      'DECENTRALIZED HEALTHCARE · SYNTHETIC DEMO RECORD',
      '(generated for the guided demo; not a real patient)',
      '',
      'Patient ID     : ' + id,
      'Report         : Complete Blood Count (CBC)',
      'Collected      : ' + new Date().toISOString().slice(0, 10),
      '',
      'Test                 Result     Reference',
      'Haemoglobin          13.8 g/dL  13.0 - 17.0',
      'WBC count            7,200 /uL  4,000 - 11,000',
      'Platelets            2.6 L/uL   1.5 - 4.1',
      'HbA1c                5.6 %      < 5.7',
      '',
      'Impression: values within normal limits.',
    ].join('\n');
    var F = win.File || File;
    return { patientId: id, file: new F([text], 'cbc-report-' + id + '.txt', { type: 'text/plain' }) };
  }

  async function requestAs(role) {
    var d = dash(role);
    d.goToSection('access');
    d.connectDemoWallet(ID[role]);
    d.goToSection('access');
    await d.lookupPatient(ctx.patientId);
    d.selectRecord(ctx.recordId);
    await wait(1400);
    var res = await d.runAccessRequest(ctx.recordId);
    await d.waitForStream(6000);
    return res;
  }

  // ---------------------------------------------------------------
  // The steps
  // ---------------------------------------------------------------
  var STEPS = [
    {
      title: 'The problem and the idea',
      theory: [
        'Hospital record systems keep every patient\'s data in one institution\'s database. That is a <strong>single point of failure</strong>, the patient has no real say over who reads their records, and there is no tamper-proof history of who did.',
        'Here the patient owns each record. Files are <strong>encrypted and stored off-chain</strong>, the <strong>access policy lives on Cardano</strong>, and every request is checked through four layers, fastest first: <span class="term">Hydra L2</span> → <span class="term">Aiken L1</span> → <span class="term">Midnight ZK</span> → <span class="term">Blockfrost L1</span>.',
      ],
      action: null,
    },
    {
      title: 'Four actors, four separate portals',
      theory: [
        'Patient, Doctor, Hospital and Insurance each <strong>sign in to their own portal</strong>. Passwords are stored only as scrypt hashes, and a sign-in issues a signed, HttpOnly session cookie.',
        'A portal is locked to its actor. Every API call says which portal it comes from, and the <strong>server refuses</strong> anything that actor is not allowed to do, whatever the browser sends.',
      ],
      watch: 'each portal on the right signs in on its own and opens with only its own menu.',
      action: async function () {
        var sess = await (await fetch('/api/auth/session', { credentials: 'same-origin' })).json();
        for (var i = 0; i < ROLES.length; i++) {
          var r = ROLES[i];
          frames[r].state.textContent = 'signing in…';
          if ((sess.actors || []).indexOf(ID[r]) === -1) {
            var res = await fetch('/api/auth/demo-login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: r }) });
            if (!res.ok) throw new Error('Demo sign-in is off on this server. Sign in to the ' + NAME[r] + ' portal at /login first, then start the demo again.');
          }
          await loadPortal(r);
          await wait(500);
        }
        ROLES.forEach(function (r) {
          expect(NAME[r] + ' portal is locked to the ' + NAME[r], dash(r).actorId === ID[r]);
        });
        var cross = await call('doctor', '/api/encrypt/upload', { method: 'POST', body: new FormData() });
        expect('Server refuses an upload from the Doctor portal', cross.status === 403, 'status ' + cross.status);
        return 'All four portals are signed in separately, and the server refused the Doctor portal\'s upload attempt.';
      },
    },
    {
      role: 'patient',
      title: 'The patient encrypts and uploads a record',
      theory: [
        'A fresh 256-bit content key is generated for this file and used with <strong>AES-256-GCM</strong>, which keeps it secret and makes any tampering detectable.',
        'Only the ciphertext is pinned to <strong>IPFS</strong>, and only a SHA-256 hash of its address is anchored, so <strong>no personal data reaches the blockchain</strong>. The content key is then wrapped with <strong>RSA-OAEP</strong> separately for each actor the patient chooses: here the Doctor and the Hospital.',
      ],
      watch: 'the upload pipeline in the Patient portal lights up as each step happens on the server.',
      action: async function () {
        var d = dash('patient');
        var win = frames.patient.iframe.contentWindow;
        var rep = syntheticReport(win);
        ctx.patientId = rep.patientId;
        d.state.grantSelection = { '02': true, '03': true, '04': false };
        d.connectDemoWallet('01');
        d.goToSection('upload');
        var pid = frameDoc('patient').querySelector('#patientIdInput');
        if (pid) pid.value = rep.patientId;
        await wait(1800);
        var res = await d.runUpload(rep.file);
        await d.waitForStream(8000);
        expect('Record encrypted, pinned and anchored', res && res.ok, res && res.error && res.error.message);
        ctx.recordId = res.data.recordId;
        var list = await call('patient', '/api/records?limit=50');
        var rec = (list.body.records || []).filter(function (x) { return x.recordId === ctx.recordId; })[0];
        var wrapped = (rec && rec.wrappedActors || []).slice().sort().join(',');
        expect('Content key wrapped for Patient, Doctor and Hospital only', wrapped === '01,02,03', 'wrapped for ' + wrapped);
        return 'Uploaded ' + rep.file.name + ' for ' + rep.patientId + '. Key wrapped for Patient, Doctor and Hospital.';
      },
    },
    {
      role: 'patient',
      title: 'The access list is shared on Hydra Layer 2',
      theory: [
        '<strong>Hydra</strong> is Cardano\'s Layer-2 state channel. The record\'s access list is published as a snapshot that every party in the head signs with <strong>Ed25519</strong>.',
        'Checking a snapshot takes milliseconds instead of the seconds a Layer-1 query needs, which is what makes blockchain-backed access practical in a clinic.',
      ],
      watch: 'the newest snapshot at the top of the feed lists exactly who may open the new record.',
      action: async function () {
        var d = dash('patient');
        d.goToSection('hydra');
        await d.loadHydra();
        var st = await call('patient', '/api/hydra/status');
        var snap = (st.body.snapshots || []).filter(function (s) { return s.recordId === ctx.recordId; })[0];
        expect('Hydra snapshot published for the new record', !!snap);
        var allowed = (snap.permittedActors || []).slice().sort().join(',');
        expect('Snapshot lists Patient, Doctor and Hospital', allowed === '01,02,03', 'lists ' + allowed);
        return 'Snapshot epoch ' + snap.epoch + ', signed by ' + (snap.signatures || 0) + ' parties' + (st.body.mode === 'simulated' ? ' (the head runs as a signed simulator on this deployment).' : '.');
      },
    },
    {
      role: 'doctor',
      title: 'The doctor sees only what is shared with them',
      theory: [
        'A requesting actor sees the records shared with it, and <strong>never who else has access</strong>. The server leaves the other names out entirely.',
        'Keeping the access list private is the same property the <strong>Midnight zero-knowledge</strong> layer provides on-chain: prove you are allowed in without revealing anyone else.',
      ],
      watch: 'the record appears under "Shared With Me", with no list of other actors.',
      action: async function () {
        var d = dash('doctor');
        await d.loadRecords();
        d.goToSection('shared');
        var mine = await call('doctor', '/api/records');
        var rec = (mine.body.records || []).filter(function (x) { return x.recordId === ctx.recordId; })[0];
        expect('Doctor sees the shared record', !!rec);
        expect('Doctor cannot see who else has access', rec && !('wrappedActors' in rec) && !('owner' in rec));
        return 'The record is listed for the Doctor, without the access list or the owner\'s address.';
      },
    },
    {
      role: 'doctor',
      title: 'Requesting access: the four-layer cascade',
      theory: [
        'The request is checked by four layers, <strong>cheapest and fastest first</strong>: Hydra L2 (milliseconds), the Aiken Plutus V3 validator on L1, a Midnight zero-knowledge proof, and finally a public Blockfrost query.',
        'The first layer that can decide answers. A miss or an error falls through to the next layer, so there is always an authoritative answer.',
      ],
      watch: 'the cascade panel shows which layer answered and how long it took.',
      action: async function () {
        var res = await requestAs('doctor');
        expect('Doctor is granted access', res && res.ok, res && res.error && res.error.message);
        ctx.doctorMethod = res.data.verificationMethod;
        return 'Granted by ' + res.data.verificationMethod + '. The Doctor now holds their own wrapped copy of the key.';
      },
    },
    {
      role: 'doctor',
      title: 'Unlock and decrypt',
      theory: [
        'The Doctor\'s wrapped key is unwrapped with their RSA private key, and the file is decrypted with <strong>AES-256-GCM</strong>.',
        'GCM checks an authentication tag first. If even one bit of the stored file had changed, decryption would <strong>fail closed</strong> instead of returning corrupted data.',
      ],
      watch: 'the decrypted report appears in the Doctor portal.',
      action: async function () {
        var res = await dash('doctor').runUnlock(ctx.recordId, '02');
        expect('Doctor decrypts the original report', res && res.ok, res && res.error && res.error.message);
        var pre = frameDoc('doctor').querySelector('#unlockPreview');
        await wait(600);
        expect('Decrypted text matches what the patient uploaded', pre && pre.textContent.indexOf('Haemoglobin') !== -1);
        return 'Decrypted ' + res.filename + ' in the Doctor portal.';
      },
    },
    {
      role: 'hospital',
      title: 'The hospital has its own key too',
      theory: [
        'The Hospital was also granted access, so it holds its <strong>own</strong> wrapped copy of the content key. No two actors share key material.',
        'This sets up the next part: what happens when the patient takes access away.',
      ],
      watch: 'the Hospital is granted through the same cascade.',
      action: async function () {
        var res = await requestAs('hospital');
        expect('Hospital is granted access', res && res.ok, res && res.error && res.error.message);
        return 'Granted by ' + res.data.verificationMethod + '.';
      },
    },
    {
      role: 'insurance',
      title: 'Insurance is refused',
      theory: [
        'The insurer was never granted access. It can look up the patient\'s records by ID, but the lookup reveals <strong>nothing about who may open them</strong>.',
        'When it asks, the cascade finds it is not on the access list and refuses. There is no wrapped key for the insurer, so there is nothing it could decrypt.',
      ],
      watch: 'the refusal, and which layer gave it.',
      action: async function () {
        var res = await requestAs('insurance');
        expect('Insurance is refused', res && !res.ok);
        var shared = await call('insurance', '/api/records');
        expect('Nothing is listed as shared with Insurance', !(shared.body.records || []).some(function (x) { return x.recordId === ctx.recordId; }));
        return 'Refused: ' + (res.error ? res.error.message : 'not on the access list');
      },
    },
    {
      role: 'patient',
      title: 'The patient revokes the hospital: key rotation',
      theory: [
        'Revoking is not just deleting a row. The file is <strong>re-encrypted under a brand-new content key</strong>, re-wrapped for the actors who keep access, re-pinned, and the new access list is published on Hydra.',
        'Any copy of the old key is now useless. Destroying the key is also how the design meets the <strong>GDPR right to erasure</strong> on an immutable ledger: only a meaningless hash stays on-chain.',
      ],
      watch: 'the rotation pipeline runs every step on the server.',
      action: async function () {
        var d = dash('patient');
        await d.loadRecords();
        d.goToSection('records');
        await wait(1400);
        var res = await d.runRevoke(ctx.recordId, '03');
        await d.waitForStream(8000);
        expect('Hospital revoked with key rotation', res && res.ok, res && res.error && res.error.message);
        var after = (res.data.record && res.data.record.wrappedActors || []).slice().sort().join(',');
        expect('Only Patient and Doctor keep a key', after === '01,02', 'keys for ' + after);
        return 'Rotation ' + (res.data.rotation && res.data.rotation.status) + '. Keys now exist only for the Patient and the Doctor.';
      },
    },
    {
      role: 'hospital',
      title: 'The hospital is locked out',
      theory: [
        'The Hospital asks again. The new access list no longer includes it, so the cascade refuses, and even a key it saved earlier cannot open the re-encrypted file.',
        'Revocation is enforced by <strong>cryptography</strong>, not by trusting a database flag.',
      ],
      watch: 'the refusal, and the record disappearing from "Shared With Me".',
      action: async function () {
        var res = await requestAs('hospital');
        expect('Hospital is refused after revocation', res && !res.ok);
        var shared = await call('hospital', '/api/records');
        expect('Record no longer shared with Hospital', !(shared.body.records || []).some(function (x) { return x.recordId === ctx.recordId; }));
        return 'Refused: ' + (res.error ? res.error.message : 'not on the access list');
      },
    },
    {
      role: 'patient',
      title: 'Every decision is in the audit trail',
      theory: [
        'Every upload, grant, access decision, key operation and revocation is logged, kept for 90 days, and contains <strong>no health information</strong>, in line with HIPAA and GDPR.',
        'The patient sees the full trail of their records. Each requesting actor sees <strong>only its own</strong> activity.',
      ],
      watch: 'grants and refusals for this record in the Patient\'s access history.',
      action: async function () {
        var d = dash('patient');
        await d.loadAudit();
        d.goToSection('audit');
        var all = await call('patient', '/api/logs/view?type=audit&lines=200');
        var mine = (all.body.logs || []).filter(function (l) { return l.recordId === ctx.recordId; });
        var events = mine.map(function (l) { return l.event; });
        expect('Audit trail records the grants', events.indexOf('ACCESS_GRANTED') !== -1);
        expect('Audit trail records the refusals', events.indexOf('ACCESS_DENIED') !== -1);
        var doc = await call('doctor', '/api/logs/view?type=audit&lines=200');
        var foreign = (doc.body.logs || []).filter(function (l) { return l.actorId && l.actorId !== '02'; });
        expect('Doctor sees only its own activity', foreign.length === 0, foreign.length + ' entries from other actors');
        return mine.length + ' audit events for this record, including grants, refusals and the key rotation.';
      },
    },
  ];

  // ---------------------------------------------------------------
  // Finale
  // ---------------------------------------------------------------
  function finale(error) {
    var passed = results.filter(function (r) { return r.pass; }).length;
    var wrap = document.createElement('div');
    wrap.className = 'finale';
    wrap.innerHTML =
      '<div class="finale__card">' +
        '<h2>' + (error ? 'The demo stopped' : 'End-to-end run complete') + '</h2>' +
        '<p class="finale__score">' + passed + ' of ' + results.length + ' checks passed' + (error ? ' — ' + esc(error) : '') + '</p>' +
        '<div class="finale__grid">' +
          '<div class="finale__item"><b>Patient-owned access</b>Only the patient grants or revokes, and each actor works in its own locked portal.</div>' +
          '<div class="finale__item"><b>Encrypted off-chain</b>AES-256-GCM files on IPFS; only a hash is anchored on Cardano.</div>' +
          '<div class="finale__item"><b>Four-layer cascade</b>Hydra L2 first for speed, then Aiken L1, Midnight ZK and Blockfrost L1.</div>' +
          '<div class="finale__item"><b>Private access lists</b>Requesters never see who else has access.</div>' +
          '<div class="finale__item"><b>Revocation by key rotation</b>A revoked actor\'s old key no longer opens the file.</div>' +
          '<div class="finale__item"><b>Audited</b>Every decision logged, with no health data in the logs.</div>' +
        '</div>' +
        '<div class="finale__actions">' +
          '<button class="btn" id="againBtn" type="button">Run it again</button>' +
          '<a class="btn btn--ghost-outline" href="/login">Open the portals</a>' +
          '<button class="btn btn--ghost-outline" id="closeFinale" type="button">Close</button>' +
        '</div>' +
      '</div>';
    $('#stage').appendChild(wrap);
    $('#againBtn').addEventListener('click', function () { wrap.remove(); start(); });
    $('#closeFinale').addEventListener('click', function () { wrap.remove(); focus(null); });
  }

  // ---------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------
  async function start() {
    if (run) return;
    run = { paused: false, skip: false };
    results = [];
    ctx = {};
    $('#results').innerHTML = ''; $('#results').hidden = true;
    var old = $('.finale'); if (old) old.remove();
    $('#startBtn').hidden = true; $('#pauseBtn').hidden = false; $('#nextBtn').hidden = false;
    $('#pauseBtn').textContent = 'Pause';
    var total = STEPS.length;
    var error = null;
    try {
      for (var i = 0; i < STEPS.length; i++) {
        var step = STEPS[i];
        narrate(step, i + 1, total);
        if (step.role) focus(step.role); else if (i > 0) focus(null);
        await wait(step.action ? READ_MS : READ_MS + 2500);
        await untilResumed();
        if (step.action) {
          setCheck('running', 'Running in the ' + (step.role ? NAME[step.role] + ' portal' : 'portals') + '…');
          var summary = await step.action();
          setCheck('pass', summary);
          await wait(READ_MS);
          await untilResumed();
        }
      }
      $('#progressBar').style.width = '100%';
      $('#stepCount').textContent = 'Done';
    } catch (e) {
      if (e instanceof Stopped) { resetControls(); return; }
      error = e.message || String(e);
      setCheck('fail', error);
    }
    resetControls();
    focus(null);
    finale(error);
  }
  function resetControls() {
    run = null;
    $('#startBtn').hidden = false; $('#pauseBtn').hidden = true; $('#nextBtn').hidden = true;
    $('#startBtn').innerHTML = icon('play', 16) + ' Start the demo';
  }
  function togglePause() {
    if (!run) return;
    run.paused = !run.paused;
    $('#pauseBtn').textContent = run.paused ? 'Resume' : 'Pause';
  }
  function skip() { if (run) run.skip = true; }
  function stop() { if (run) { run = null; resetControls(); setCheck('fail', 'Stopped.'); } }

  document.addEventListener('DOMContentLoaded', function () {
    injectIcons(document);
    layout();
    $('#startBtn').addEventListener('click', start);
    $('#pauseBtn').addEventListener('click', togglePause);
    $('#nextBtn').addEventListener('click', skip);
    document.addEventListener('keydown', function (e) {
      if (!run) return;
      if (e.key === ' ') { e.preventDefault(); togglePause(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); skip(); }
      else if (e.key === 'Escape') { stop(); }
    });
    if (new URLSearchParams(location.search).get('autostart') === '1') start();
  });

  // For automated runs (and debugging): the results so far.
  window.PresenterDemo = { results: function () { return results.slice(); }, isRunning: function () { return !!run; }, setReadMs: function (ms) { READ_MS = ms; } };
})();
