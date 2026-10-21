/* Cardano Healthcare Vault — guided demo
 * One click runs the whole story end to end: upload,
 * Hydra L2 sharing, the permission cascade, decryption, a refused actor,
 * revocation with key rotation, and the audit trail. Every step calls the
 * same dashboard functions the buttons use (window.VaultDash), so what the
 * audience sees is the real backend responding, narrated.
 */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function icon(name, size) { return window.VaultIcons ? window.VaultIcons.icon(name, { size: size || 16 }) : ''; }

  var ACTOR_NAME = { '01': 'Patient', '02': 'Doctor', '03': 'Hospital', '04': 'Insurance' };
  var READ_MS = 4200; // how long narration stays up before moving on

  var tour = null; // { token, paused, skip, results, bar }

  // ---------------------------------------------------------------
  // Pacing: sleeps that respect pause, "next" and exit
  // ---------------------------------------------------------------
  function Aborted() {}
  function wait(ms) {
    var my = tour;
    return new Promise(function (resolve, reject) {
      var left = ms;
      var last = Date.now();
      (function tick() {
        if (!tour || tour !== my) return reject(new Aborted());
        var now = Date.now();
        if (!tour.paused) left -= now - last;
        last = now;
        if (tour.skip) { tour.skip = false; return resolve(); }
        if (left <= 0) return resolve();
        setTimeout(tick, 60);
      })();
    });
  }
  async function whilePaused() {
    while (tour && tour.paused) await wait(150);
    if (!tour) throw new Aborted();
  }
  function guard(my) { if (!tour || tour !== my) throw new Aborted(); }

  // ---------------------------------------------------------------
  // Synthetic medical file used for the upload step
  // ---------------------------------------------------------------
  function syntheticReport() {
    var id = 'PT-' + (2000 + Math.floor(Math.random() * 7999));
    var today = new Date().toISOString().slice(0, 10);
    var text = [
      'CARDANO HEALTHCARE VAULT · SYNTHETIC DEMO RECORD',
      '(generated for the guided demo; not a real patient)',
      '',
      'Patient ID     : ' + id,
      'Report         : Complete Blood Count (CBC)',
      'Collected      : ' + today,
      'Ordering doctor: Dr. A. Rao (synthetic)',
      '',
      'Test                 Result     Reference',
      'Haemoglobin          13.8 g/dL  13.0 – 17.0',
      'WBC count            7,200 /µL  4,000 – 11,000',
      'Platelets            2.6 L/µL   1.5 – 4.1',
      'RBC count            4.9 M/µL   4.5 – 5.5',
      'HbA1c                5.6 %      < 5.7',
      '',
      'Impression: values within normal limits.',
    ].join('\n');
    return { patientId: id, file: new File([text], 'cbc-report-' + id + '.txt', { type: 'text/plain' }) };
  }

  // ---------------------------------------------------------------
  // UI: narration bar, spotlight and finale
  // ---------------------------------------------------------------
  function buildBar() {
    var bar = document.createElement('div');
    bar.className = 'tour';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML =
      '<div class="tour__progress"><span id="tourProgress"></span></div>' +
      '<div class="tour__head">' +
        '<span class="tour__step" id="tourStep"></span>' +
        '<span class="tour__actor" id="tourActor"></span>' +
      '</div>' +
      '<div class="tour__title" id="tourTitle"></div>' +
      '<div class="tour__text" id="tourText"></div>' +
      '<div class="tour__controls">' +
        '<button class="tour__btn" id="tourPause" type="button">' + icon('pause', 14) + '<span>Pause</span></button>' +
        '<button class="tour__btn" id="tourNext" type="button">' + icon('skipForward', 14) + '<span>Next</span></button>' +
        '<button class="tour__btn tour__btn--ghost" id="tourExit" type="button">' + icon('x', 14) + '<span>Exit</span></button>' +
      '</div>';
    document.body.appendChild(bar);
    $('#tourPause').addEventListener('click', togglePause);
    $('#tourNext').addEventListener('click', function () { if (tour) tour.skip = true; });
    $('#tourExit').addEventListener('click', stop);
    return bar;
  }

  function togglePause() {
    if (!tour) return;
    tour.paused = !tour.paused;
    var btn = $('#tourPause');
    btn.innerHTML = tour.paused ? icon('play', 14) + '<span>Resume</span>' : icon('pause', 14) + '<span>Pause</span>';
    document.body.classList.toggle('is-tour-paused', tour.paused);
  }

  function narrate(index, total, step) {
    $('#tourStep').textContent = 'Step ' + (index + 1) + ' of ' + total;
    var actor = $('#tourActor');
    actor.textContent = step.actor ? 'as ' + ACTOR_NAME[step.actor] : '';
    actor.dataset.actor = step.actor || '';
    $('#tourTitle').textContent = step.title;
    $('#tourText').innerHTML = step.text;
    $('#tourProgress').style.width = (((index + 1) / total) * 100).toFixed(1) + '%';
    var bar = tour.bar;
    bar.classList.remove('is-swap');
    void bar.offsetWidth; // restart the swap animation
    bar.classList.add('is-swap');
  }

  function say(html) { var t = $('#tourText'); if (t) t.innerHTML = html; }

  function focus(selector) {
    document.querySelectorAll('.tour-focus').forEach(function (n) { n.classList.remove('tour-focus'); });
    if (!selector) return;
    var node = document.querySelector(selector);
    if (!node) return;
    node.classList.add('tour-focus');
    // Manual scroll: scrollIntoView also scrolls sticky/overflow ancestors,
    // which shoved the whole shell off screen in some browsers.
    var rect = node.getBoundingClientRect();
    var room = window.innerHeight - 240; // keep clear of the narration bar
    var top = window.scrollY + rect.top - Math.max(90, (room - Math.min(rect.height, room)) / 2);
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function useActor(actorId, section) {
    var d = window.VaultDash;
    d.setActor(actorId);
    if (!d.state.walletConnected[actorId]) d.connectDemoWallet(actorId);
    d.goToSection(section);
  }

  // ---------------------------------------------------------------
  // The story
  // ---------------------------------------------------------------
  function buildSteps() {
    var d = window.VaultDash;
    var r = tour.results;

    return [
      {
        title: 'A medical record only the patient unlocks',
        text: 'Files are encrypted with AES-256-GCM, stored on IPFS, and the key is only released after <strong>four independent layers</strong> agree. This demo runs every step against the live backend.',
        run: async function () {
          useActor('01', 'overview');
          focus('.layer-ladder');
          await wait(READ_MS + 800);
        },
      },
      {
        title: 'The Hydra L2 head is already running',
        text: 'Hydra is Cardano’s off-chain state channel. Four parties (Patient, Doctor, Hospital, Insurance) co-sign every snapshot. Background traffic from other synthetic patients keeps the head busy.',
        run: async function () {
          d.goToSection('hydra');
          await d.loadHydra();
          r.epochBefore = d.state.hydra && d.state.hydra.epoch;
          focus('#snapFeed');
          await wait(READ_MS);
          focus('#partyList');
          say('Each snapshot carries <strong>4 Ed25519 signatures</strong>, one per party, re-verified on every read. If any signature fails, the head is not trusted.');
          await wait(READ_MS);
        },
      },
      {
        actor: '01',
        title: 'The patient uploads a lab report',
        text: 'A synthetic CBC report is created in the browser. The patient grants access to the <strong>Doctor</strong> and the <strong>Hospital</strong>, but not to Insurance.',
        run: async function (my) {
          d.state.grantSelection = { '02': true, '03': true, '04': false };
          useActor('01', 'upload');
          var rep = syntheticReport();
          r.patientId = rep.patientId;
          var pid = $('#patientIdInput'); if (pid) pid.value = rep.patientId;
          var label = $('#fileLabel'); if (label) label.textContent = rep.file.name + ' — ' + rep.file.size + ' B';
          var upBtn = $('#uploadBtn'); if (upBtn) upBtn.textContent = 'Encrypting & anchoring…';
          focus('#dropzone');
          await wait(2600);
          guard(my);
          focus('#flow');
          say('Watch the pipeline: a fresh 256-bit key is generated, the file is encrypted, pinned to IPFS, the key is wrapped separately for each actor, and the new access list is <strong>shared to the Hydra head</strong>.');
          var res = await d.runUpload(rep.file);
          guard(my);
          await d.waitForStream();
          if (!res.ok) throw new Error('Upload failed: ' + res.error.message);
          r.recordId = res.data.recordId;
          r.fileName = rep.file.name;
          await wait(READ_MS - 1000);
        },
      },
      {
        title: 'A new snapshot lands on the head',
        text: 'The upload became a <strong>real</strong> snapshot on the Hydra head, signed by all four parties in milliseconds. It sits among the synthetic traffic, tagged “real”.',
        run: async function () {
          d.goToSection('hydra');
          await d.loadHydra();
          r.epochAfter = d.state.hydra && d.state.hydra.epoch;
          focus('.snap-row--real');
          await wait(READ_MS + 600);
        },
      },
      {
        actor: '02',
        title: 'The doctor asks for the file',
        text: 'The Doctor signs an access request with their wallet. The server checks the layers in order, cheapest first: <strong>Hydra L2</strong> answers before the chain is ever touched.',
        run: async function (my) {
          useActor('02', 'access');
          var sel = $('#recordSelect'); if (sel) sel.value = r.recordId;
          focus('#flow');
          await wait(1800);
          guard(my);
          var res = await d.runAccessRequest(r.recordId);
          guard(my);
          await d.waitForStream();
          if (res.ok) {
            r.doctorMethod = res.data.verificationMethod;
            r.doctorMs = res.data.verificationTime;
            say('Granted by <strong>' + escapeHtml(res.data.verificationMethod) + '</strong> in ' + escapeHtml(res.data.verificationTime) + ' ms. The doctor gets back <em>their own</em> wrapped copy of the key, never the raw key.');
          } else {
            say('The request was refused: ' + escapeHtml(res.error.message));
          }
          await wait(READ_MS);
        },
      },
      {
        actor: '02',
        title: 'Unwrap and decrypt',
        text: 'The doctor’s wrapped key is opened with their private key and the file is decrypted. The cascade runs <strong>again</strong>: holding an old key is never enough.',
        run: async function (my) {
          focus('#unlockArea');
          var res = await d.runUnlock(r.recordId, '02');
          guard(my);
          if (res.ok) {
            r.unlocked = true;
            say('Decrypted <strong>' + escapeHtml(res.filename) + '</strong>. AES-GCM also proved the file was not tampered with while on IPFS.');
          } else {
            say('Decryption is not available on this deployment (' + escapeHtml(res.error.message) + '). Access itself was granted in the previous step.');
          }
          focus('#unlockArea');
          await wait(READ_MS + 800);
        },
      },
      {
        actor: '04',
        title: 'Insurance tries the same file',
        text: 'Insurance was never granted access. Its request goes through the same cascade, so the audience can see exactly where it stops.',
        run: async function (my) {
          useActor('04', 'access');
          var sel = $('#recordSelect'); if (sel) sel.value = r.recordId;
          focus('#flow');
          await wait(1600);
          guard(my);
          var res = await d.runAccessRequest(r.recordId);
          guard(my);
          await d.waitForStream();
          r.insuranceDenied = !res.ok;
          say(res.ok
            ? 'Unexpectedly granted. Check the record’s access list.'
            : 'Refused. <strong>Hydra L2</strong> has this record’s access list and Insurance is not on it, so the key is never released.');
          focus('#unlockArea');
          await wait(READ_MS);
        },
      },
      {
        actor: '01',
        title: 'The patient revokes the hospital',
        text: 'Revoking does more than delete a row. The file is <strong>re-encrypted under a brand-new key</strong>, re-wrapped for everyone who remains, and the change is published to the Hydra head.',
        run: async function (my) {
          useActor('01', 'records');
          await wait(400);
          var card = document.querySelector('.record-card');
          if (card) { card.classList.add('is-open'); focus('.record-card'); }
          await wait(2400);
          guard(my);
          focus('#flow');
          var res = await d.runRevoke(r.recordId, '03');
          guard(my);
          await d.waitForStream();
          r.revoked = res.ok;
          r.rotation = res.ok ? res.data.rotation.status : 'failed';
          say(res.ok
            ? 'Key rotation <strong>' + escapeHtml(res.data.rotation.status) + '</strong>. The old key is now useless, even to someone who copied it earlier.'
            : 'Revoke failed: ' + escapeHtml(res.error.message));
          await wait(READ_MS);
        },
      },
      {
        actor: '03',
        title: 'The hospital is locked out',
        text: 'The Hospital had access a minute ago. Now its request hits the updated Hydra snapshot and stops there.',
        run: async function (my) {
          useActor('03', 'access');
          var sel = $('#recordSelect'); if (sel) sel.value = r.recordId;
          focus('#flow');
          await wait(1400);
          guard(my);
          var res = await d.runAccessRequest(r.recordId);
          guard(my);
          await d.waitForStream();
          r.hospitalDenied = !res.ok;
          say(res.ok
            ? 'Still granted. Revocation did not take effect.'
            : 'Refused. Even if a layer were stale, the Hospital no longer holds a current wrapped key, so access <strong>fails closed</strong>.');
          await wait(READ_MS);
        },
      },
      {
        title: 'Everything is on the record',
        text: 'Every grant, refusal, key wrap and rotation is written to a tamper-evident audit log for HIPAA/GDPR-style accountability.',
        run: async function () {
          await d.loadAudit();
          d.goToSection('audit');
          focus('#auditStats');
          r.auditCount = d.state.auditEvents.filter(function (ev) { return new Date(ev.timestamp).getTime() >= r.startedAt; }).length;
          await wait(READ_MS + 600);
        },
      },
    ];
  }

  // ---------------------------------------------------------------
  // Finale
  // ---------------------------------------------------------------
  function showFinale() {
    var r = tour.results;
    var wrap = document.createElement('div');
    wrap.className = 'tour-finale';
    function line(ok, text) {
      return '<li class="' + (ok ? 'is-ok' : 'is-warn') + '">' + icon(ok ? 'checkCircle2' : 'xCircle', 16) + '<span>' + text + '</span></li>';
    }
    wrap.innerHTML =
      '<div class="tour-finale__card">' +
        '<div class="tour-finale__kicker">' + icon('sparkles', 14) + ' Demo complete</div>' +
        '<h2>One record, four layers, zero trust in a single database flag.</h2>' +
        '<ul class="tour-finale__list">' +
          line(!!r.recordId, 'Encrypted and stored <strong>' + escapeHtml(r.fileName || 'record') + '</strong> on IPFS') +
          line(r.epochAfter > r.epochBefore, 'Shared to the Hydra head: epoch ' + escapeHtml(r.epochBefore) + ' → ' + escapeHtml(r.epochAfter)) +
          line(!!r.doctorMethod, 'Doctor granted via <strong>' + escapeHtml(r.doctorMethod || '—') + '</strong> in ' + escapeHtml(r.doctorMs != null ? r.doctorMs : '—') + ' ms' + (r.unlocked ? ', file decrypted' : '')) +
          line(!!r.insuranceDenied, 'Insurance refused: never granted') +
          line(!!r.revoked, 'Hospital revoked, key rotation ' + escapeHtml(r.rotation || '—')) +
          line(!!r.hospitalDenied, 'Hospital locked out after revocation') +
          line(r.auditCount > 0, escapeHtml(r.auditCount || 0) + ' audit events written during this demo') +
        '</ul>' +
        '<div class="tour-finale__actions">' +
          '<button class="btn" id="finaleReplay" type="button">' + icon('play', 15) + ' Run it again</button>' +
          '<button class="btn btn--ghost-outline" id="finaleClose" type="button">Explore on my own</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    $('#finaleReplay').addEventListener('click', function () { wrap.remove(); start(); });
    $('#finaleClose').addEventListener('click', function () { wrap.remove(); window.VaultDash.goToSection('overview'); });
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------
  async function start() {
    if (tour) return;
    var d = window.VaultDash;
    if (!d) return;
    var old = document.querySelector('.tour-finale'); if (old) old.remove();

    tour = { paused: false, skip: false, results: { startedAt: Date.now() - 2000 }, bar: null };
    var my = tour;
    tour.bar = buildBar();
    document.body.classList.add('is-touring');
    var btn = $('#runDemoBtn'); if (btn) btn.disabled = true;

    var steps = buildSteps();
    try {
      if (!d.isDemoMode()) {
        d.toast('Heads up: the server is not in DEMO_MODE, so the demo wallet signatures may be rejected.', true);
      }
      for (var i = 0; i < steps.length; i += 1) {
        guard(my);
        await whilePaused();
        narrate(i, steps.length, steps[i]);
        await steps[i].run(my);
      }
      guard(my);
      cleanup();
      tour = my; // keep results for the finale
      showFinale();
      tour = null;
    } catch (err) {
      if (err instanceof Aborted) return;
      say('<strong>The demo stopped:</strong> ' + escapeHtml(err.message));
      $('#tourPause').disabled = true;
      $('#tourNext').disabled = true;
      document.body.classList.remove('is-touring');
      // keep the bar up so the presenter can read what went wrong; Exit clears it
    }
  }

  function cleanup() {
    document.querySelectorAll('.tour-focus').forEach(function (n) { n.classList.remove('tour-focus'); });
    document.body.classList.remove('is-touring', 'is-tour-paused');
    var bar = document.querySelector('.tour'); if (bar) bar.remove();
    var btn = $('#runDemoBtn'); if (btn) btn.disabled = false;
  }

  function stop() {
    cleanup();
    tour = null;
  }

  document.addEventListener('keydown', function (e) {
    if (!tour) return;
    if (e.key === 'Escape') stop();
    else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePause(); }
    else if (e.key === 'ArrowRight') tour.skip = true;
  });

  window.VaultTour = { start: start, stop: stop };

  // /dashboard?demo=1 (the landing page's "Run demo" button) starts it straight away.
  document.addEventListener('DOMContentLoaded', function () {
    if (/[?&]demo=1\b/.test(location.search)) {
      history.replaceState(null, '', location.pathname);
      setTimeout(start, 900);
    }
  });
})();
