/* Cardano Healthcare Vault — dashboard
 * Sidebar-navigated app shell around the same real backend calls as
 * before (no client-side simulation — every pipeline node lights up
 * from an actual SSE event the server emits at that exact step).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------
  var ACTOR_META = {
    '01': { name: 'Patient', role: 'Owner', addr: 'addr_test1demo_patient_vault' },
    '02': { name: 'Doctor', role: 'Requester', addr: 'addr_test1demo_doctor_vault' },
    '03': { name: 'Hospital', role: 'Requester', addr: 'addr_test1demo_hospital_vault' },
    '04': { name: 'Insurance', role: 'Requester', addr: 'addr_test1demo_insurance_vault' },
  };

  var ROLE_ICONS = { '01': 'user', '02': 'stethoscope', '03': 'building2', '04': 'umbrella' };
  function roleIcon(actorId) { return ROLE_ICONS[actorId] || 'user'; }
  var ROLE_ACCENT = { '01': 'icon-badge--patient', '02': 'icon-badge--doctor', '03': 'icon-badge--hospital', '04': 'icon-badge--insurance' };
  function roleAccent(actorId) { return ROLE_ACCENT[actorId] || ''; }

  // Which portal this page is. The server only serves /portal/<role> to a
  // browser signed in as that actor and locks every API call to it.
  var PORTAL_ROLE = document.body.dataset.role || 'patient';
  var PORTAL_ACTOR = document.body.dataset.actor || '01';
  var IS_OWNER = PORTAL_ACTOR === '01';

  var SECTION_META = {
    overview: { title: 'Overview' },
    upload: { title: 'Upload & Encrypt' },
    records: { title: 'My Records' },
    shared: { title: 'Shared With Me' },
    access: { title: 'Request Access' },
    hydra: { title: 'Hydra L2 Network' },
    audit: { title: IS_OWNER ? 'Access History' : 'My Activity' },
    actors: { title: 'Actors' },
  };

  // Each portal shows only what its actor can do.
  var PORTAL_NAV = IS_OWNER ? [
    { id: 'overview', icon: 'home', label: 'Overview' },
    { id: 'upload', icon: 'cloudUpload', label: 'Upload & Encrypt' },
    { id: 'records', icon: 'files', label: 'My Records' },
    { id: 'audit', icon: 'clipboardList', label: 'Access History' },
    { id: 'hydra', icon: 'zap', label: 'Hydra L2 Network', live: true },
  ] : [
    { id: 'overview', icon: 'home', label: 'Overview' },
    { id: 'shared', icon: 'files', label: 'Shared With Me' },
    { id: 'access', icon: 'shieldCheck', label: 'Request Access' },
    { id: 'audit', icon: 'clipboardList', label: 'My Activity' },
  ];

  var UPLOAD_FLOW = [
    { key: 'validate', label: 'Validate file' },
    { key: 'generate-cek', label: 'Generate CEK — AES-256' },
    { key: 'encrypt', label: 'Encrypt — AES-256-GCM' },
    { key: 'ipfs-pin', label: 'Pin to IPFS' },
    { key: 'wrap-keys', label: 'Wrap CEK — RSA-OAEP' },
    { key: 'db-save', label: 'Anchor record' },
    { key: 'hydra-share', label: 'Share via Hydra L2' },
  ];

  var ACCESS_FLOW = [
    { key: 'hydra', label: 'Hydra L2', detail: 'off-chain state channel · 5–15ms target' },
    { key: 'aiken', label: 'Aiken L1', detail: 'Plutus V3 permission validator' },
    { key: 'midnight', label: 'Midnight ZK', detail: 'zero-knowledge permission proof' },
    { key: 'blockfrost', label: 'Blockfrost L1', detail: 'public on-chain fallback' },
    { key: 'local-db-demo', label: 'Local DB (demo fallback)', detail: 'used only when Blockfrost is unset', optional: true },
  ];

  var REVOKE_FLOW = [
    { key: 'revoke-actor', label: 'Remove actor from record' },
    { key: 'download', label: 'Download old package — IPFS' },
    { key: 'unwrap-old-cek', label: 'Unwrap old CEK' },
    { key: 'decrypt-old', label: 'Decrypt with old CEK' },
    { key: 'generate-new-cek', label: 'Generate new CEK' },
    { key: 're-encrypt', label: 'Re-encrypt — AES-256-GCM' },
    { key: 'ipfs-reupload', label: 'Re-upload to IPFS' },
    { key: 'update-record', label: 'Update record CID' },
    { key: 're-wrap-keys', label: 'Re-wrap remaining actors' },
    { key: 'anchor-update', label: 'Update on-chain anchor' },
    { key: 'hydra-sync', label: 'Publish revocation — Hydra L2' },
  ];

  var EVENT_LABELS = {
    ACCESS_GRANTED: 'Access granted',
    ACCESS_DENIED: 'Access denied',
    CEK_WRAPPED: 'Key wrapped',
    CEK_UNWRAPPED: 'Key unwrapped',
    CEK_ROTATED: 'Key rotated',
    SIGNATURE_VERIFICATION_FAILED: 'Signature check failed',
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
    ACTOR_REGISTERED: 'Actor registered',
    ACTOR_DEACTIVATED: 'Actor deactivated',
    FILE_UPLOADED: 'File uploaded',
    PERMISSION_CHECK: 'Permission check',
    REVOCATION: 'Revocation',
  };

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  var state = {
    section: 'overview',
    actorId: PORTAL_ACTOR,
    lookupRecords: [],
    lookupPatient: '',
    preselectRecord: '',
    otherRecords: [],
    records: [],
    auditEvents: [],
    activeES: null,
    grantSelection: { '02': true, '03': true, '04': false },
    auditFilters: { search: '', event: '', lines: 50 },
    auditTimer: null,
    // walletConnected[actorId] is a plain boolean gate (kept simple since
    // several button-enable checks already key off it); wallets[actorId]
    // holds the real CIP-30 session for that slot — the enabled API object
    // plus the address actually returned by the wallet. Note this maps a
    // demo "role" (Patient/Doctor/...) onto whatever account is currently
    // active in the one wallet extension in this browser — to get distinct
    // addresses per actor, switch the active account in Eternl before each
    // "Connect Wallet" click.
    walletConnected: {},
    wallets: {},
    sessionActors: [],   // actors signed in on this browser (from the server session)
    uploadFileChosen: false,
    hydraTimer: null,
    hydra: null,
    hydraSeen: {},
    benchmark: null,
    config: null,
  };
  var CARDANO_NETWORK_LABEL = 'testnet'; // overwritten from the server's /api/config on boot
  var SERVER_DEMO_MODE = false;          // ditto — enables the demo wallet fallback below

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, className, html) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatBytes(n) {
    if (!n && n !== 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function timeAgo(iso) {
    var d = Date.now() - new Date(iso).getTime();
    if (d < 5000) return 'just now';
    if (d < 60000) return Math.floor(d / 1000) + 's ago';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    return Math.floor(d / 3600000) + 'h ago';
  }
  function shortId(id) { return id ? id.slice(0, 8) + '…' : '—'; }
  function shortAddr(addr) { return addr ? addr.slice(0, 14) + '…' + addr.slice(-4) : '—'; }
  function sessionId() { return 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ---------------------------------------------------------------
  // Real CIP-30 wallet (Eternl) — connect, address, balance, CIP-8 signing.
  // ---------------------------------------------------------------
  async function connectRealWallet(actorId) {
    if (!window.cardano || !window.cardano.eternl) {
      if (SERVER_DEMO_MODE) return connectDemoWallet(actorId);
      throw new Error('Eternl wallet not found — install it from https://eternl.io and reload this page.');
    }
    var api = await window.cardano.eternl.enable();

    var addresses = await api.getUsedAddresses();
    if (!addresses || !addresses.length) addresses = await api.getUnusedAddresses();
    if (!addresses || !addresses.length) {
      var changeAddr = await api.getChangeAddress();
      if (changeAddr) addresses = [changeAddr];
    }
    if (!addresses || !addresses.length) {
      throw new Error('No addresses found in wallet — create a receiving address in Eternl first.');
    }
    var address = addresses[0];

    var balanceAda = '0.00';
    try {
      var balanceHex = await api.getBalance();
      balanceAda = (parseInt(balanceHex, 16) / 1000000).toFixed(2);
    } catch (e) { /* some wallets omit this on testnet; not fatal */ }

    state.wallets[actorId] = { api: api, address: address, balanceAda: balanceAda };
    state.walletConnected[actorId] = true;
    return state.wallets[actorId];
  }

  // Demo wallet — only offered when the server runs with DEMO_MODE=true,
  // where walletService bypasses CIP-8 verification anyway. Lets the full
  // pipeline be demoed in a browser without the Eternl extension.
  function connectDemoWallet(actorId) {
    var api = {
      signData: async function () { return { key: 'demo-wallet', signature: 'demo-wallet' }; },
    };
    state.wallets[actorId] = { api: api, address: ACTOR_META[actorId].addr, balanceAda: '0.00', demo: true };
    state.walletConnected[actorId] = true;
    return state.wallets[actorId];
  }

  function disconnectRealWallet(actorId) {
    delete state.wallets[actorId];
    state.walletConnected[actorId] = false;
  }

  // Builds the exact object the server reconstructs in walletService's
  // createSignPayload(operation, recordId, additionalData) — same key
  // order, same values — so the CIP-8 signature verifies. The server
  // reuses OUR timestamp (passed back in the request body as `timestamp`)
  // instead of stamping its own, which is why this has to round-trip.
  function buildSignPayload(operation, recordId, extra) {
    var payload = { operation: operation, recordId: recordId, timestamp: Date.now(), network: CARDANO_NETWORK_LABEL };
    Object.keys(extra || {}).forEach(function (k) { payload[k] = extra[k]; });
    return payload;
  }

  async function signWithWallet(actorId, operation, recordId, extra) {
    var wallet = state.wallets[actorId];
    if (!wallet) throw new Error('Wallet not connected for this actor.');
    var payload = buildSignPayload(operation, recordId, extra);
    var payloadJson = JSON.stringify(payload);
    var bytes = new TextEncoder().encode(payloadJson);
    var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    var signed = await wallet.api.signData(wallet.address, hex);
    return { signature: { key: signed.key, signature: signed.signature }, timestamp: payload.timestamp, address: wallet.address };
  }

  function injectIcons(root) {
    if (!window.VaultIcons) return;
    $all('[data-icon]', root).forEach(function (n) {
      var size = n.classList.contains('icon-badge--lg') ? 30 : n.classList.contains('icon-badge--md') ? 24 : n.classList.contains('icon-badge--sm') ? 18 : n.classList.contains('actor-row__glyph') ? 14 : n.classList.contains('actor-card__glyph') ? 20 : n.classList.contains('dash-nav__icon') ? 18 : 20;
      n.innerHTML = window.VaultIcons.icon(n.dataset.icon, { size: size });
    });
  }
  function panelHeadHtml(iconName, titleHtml, titleId, hintText, hintId, accentClass) {
    return '<div class="panel-head"><div class="panel-head__title">' +
      '<span class="icon-badge ' + (accentClass || 'icon-badge--outline') + ' icon-badge--sm" data-icon="' + iconName + '"></span>' +
      '<h2' + (titleId ? ' id="' + titleId + '"' : '') + '>' + titleHtml + '</h2></div>' +
      '<span class="panel-hint"' + (hintId ? ' id="' + hintId + '"' : '') + '>' + escapeHtml(hintText) + '</span></div>';
  }

  function toast(msg, isError) {
    var wrap = $('.toast-wrap') || (function () {
      var w = el('div', 'toast-wrap');
      document.body.appendChild(w);
      return w;
    })();
    var t = el('div', 'toast' + (isError ? ' toast--error' : ''), escapeHtml(msg));
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function portalLoginUrl() { return '/login?role=' + PORTAL_ROLE + '&next=/portal/' + PORTAL_ROLE; }
  function withPortalHeader(opts) {
    opts = opts || {};
    var h = opts.headers || {};
    h['X-Acting-As'] = PORTAL_ACTOR;
    opts.headers = h;
    opts.credentials = 'same-origin';
    return opts;
  }
  async function api(path, opts) {
    var res = await fetch(path, withPortalHeader(opts));
    var json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    if (res.status === 401) {
      location.assign(portalLoginUrl());
    }
    if (!res.ok) {
      var msg = (json && (json.error || json.message)) || (res.status + ' ' + res.statusText);
      var err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  // ---------------------------------------------------------------
  // Console + pipeline flow renderer (guarded: no-ops if the user has
  // navigated to a section that doesn't currently render these nodes)
  // ---------------------------------------------------------------
  // The console shows one plain-language headline by default (no record
  // IDs, CIDs or key material visible without an explicit click) — the
  // full log, with every ID/hash/access point, only appears once expanded.
  var consoleEventCount = 0;
  function consoleClear() {
    var headline = $('#consoleHeadline'), body = $('#consoleBody'), toggle = $('#consoleToggle');
    consoleEventCount = 0;
    if (headline) headline.textContent = 'Waiting for activity…';
    if (body) { body.innerHTML = '<span class="console__idle">// full log with record IDs and access points appears here</span>'; body.hidden = true; }
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.classList.remove('is-open'); }
  }
  function consoleLog(step, status, data) {
    var headline = $('#consoleHeadline'), body = $('#consoleBody');
    if (!headline || !body) return;
    consoleEventCount += 1;

    headline.textContent = humanizeStep(step) + ' — ' + status;

    if (body.querySelector('.console__idle')) body.innerHTML = '';
    var compact = {};
    Object.keys(data || {}).forEach(function (k) { if (data[k] !== undefined) compact[k] = data[k]; });
    var line = el('div', 'console__line');
    var payload = Object.keys(compact).length ? ' ' + JSON.stringify(compact) : '';
    line.innerHTML = '<span class="k">[' + escapeHtml(step) + ']</span> ' + escapeHtml(status) + escapeHtml(payload);
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;

    var countEl = $('#consoleCount');
    if (countEl) countEl.textContent = consoleEventCount + ' event' + (consoleEventCount === 1 ? '' : 's');
  }
  function humanizeStep(step) {
    return String(step || '').replace(/^layer:/, '').replace(/^rotate:/, '').replace(/[-_]/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  function bindConsoleToggle(root) {
    var toggle = $('#consoleToggle', root);
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var body = $('#consoleBody', root);
      var isOpen = toggle.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (body) body.hidden = !isOpen;
    });
  }

  var CURVE_SVG = '<svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M11 0 C11 8, 4 8, 4 16 C4 19, 7 21, 11 22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  function setFlow(title, hint, nodes) {
    var titleEl = $('#pipelineTitle'), hintEl = $('#pipelineHint'), flow = $('#flow');
    if (!flow) return;
    if (titleEl) titleEl.textContent = title;
    if (hintEl) hintEl.textContent = hint;
    flow.innerHTML = '';
    nodes.forEach(function (n) {
      var row = el('div', 'flow-node');
      row.dataset.key = n.key;
      row.innerHTML =
        '<span class="flow-node__connector">' + CURVE_SVG + '</span>' +
        '<span class="flow-node__dot-wrap"><span class="flow-node__dot">·</span></span>' +
        '<span class="flow-node__body">' +
          '<span class="flow-node__label">' + escapeHtml(n.label) + '</span>' +
          '<div class="flow-node__detail">' + escapeHtml(n.detail || 'idle') + '</div>' +
        '</span>';
      flow.appendChild(row);
    });
    consoleClear();
  }

  var STATUS_GLYPH = {
    running: '…', done: '✓', granted: '✓', denied: '×', error: '×',
    skipped: '–', disabled: '–', 'no-match': '–',
  };
  var STATUS_TEXT = {
    running: 'in progress…', done: 'done', granted: 'granted', denied: 'denied', error: 'failed',
    skipped: 'skipped', disabled: 'not configured', 'no-match': 'no match',
  };
  var LAYER_COLOR_VAR = { hydra: '--color-hydra', aiken: '--color-aiken', midnight: '--color-midnight', blockfrost: '--color-blockfrost' };

  function updateFlowNode(nodes, key, status, data) {
    var flow = $('#flow');
    if (!flow) return;
    var row = $('.flow-node[data-key="' + key + '"]', flow);
    if (!row) {
      row = el('div', 'flow-node');
      row.dataset.key = key;
      var label = (ACCESS_FLOW.filter(function (n) { return n.key === key; })[0] || { label: key }).label;
      row.innerHTML =
        '<span class="flow-node__connector">' + CURVE_SVG + '</span>' +
        '<span class="flow-node__dot-wrap"><span class="flow-node__dot">·</span></span>' +
        '<span class="flow-node__body"><span class="flow-node__label">' + escapeHtml(label) + '</span>' +
        '<div class="flow-node__detail">idle</div></span>';
      flow.appendChild(row);
    }
    row.className = 'flow-node is-touched is-' + status;
    var dot = $('.flow-node__dot', row);
    dot.textContent = STATUS_GLYPH[status] || '·';
    // The winning verification layer lights up in its own signature colour.
    if (LAYER_COLOR_VAR[key] && (status === 'granted' || status === 'done')) {
      var c = 'var(' + LAYER_COLOR_VAR[key] + ')';
      dot.style.background = c;
      dot.style.borderColor = c;
      dot.style.color = '#fff';
    } else {
      dot.style.background = '';
      dot.style.borderColor = '';
      dot.style.color = '';
    }
    // Plain-language only — no record IDs, CIDs or key material shown here
    // by default. The full data for this exact step is one click away in
    // the backend log below (see consoleLog / #consoleToggle).
    var detailEl = $('.flow-node__detail', row);
    detailEl.textContent = (data && data.detail) ? data.detail : (STATUS_TEXT[status] || status);
    row.classList.toggle('is-flowing', status === 'running');
  }

  // ---------------------------------------------------------------
  // SSE plumbing shared by upload / access / revoke
  // ---------------------------------------------------------------
  var REVEAL_PACE_MS = 260;
  var streamToken = 0;
  var streamState = { queue: [], draining: false, closed: true, lastEventAt: 0 };

  // Resolves once the current progress stream has closed and every queued
  // event has been revealed — used by the guided demo to pace itself.
  function waitForStream(timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 20000);
    return new Promise(function (resolve) {
      (function check() {
        var idle = streamState.closed && !streamState.draining && !streamState.queue.length;
        var quiet = Date.now() - streamState.lastEventAt > 1500 && !streamState.draining && !streamState.queue.length;
        if (idle || quiet || Date.now() > deadline) return resolve();
        setTimeout(check, 120);
      })();
    });
  }

  function openProgressStream(kind, sid, onEvent) {
    if (state.activeES) { try { state.activeES.close(); } catch (e) {} }
    streamToken += 1;
    var myToken = streamToken;
    var es = new EventSource('/api/' + kind + '/progress/' + encodeURIComponent(sid));
    state.activeES = es;

    var queue = [];
    streamState = { queue: queue, draining: false, closed: false, lastEventAt: Date.now() };
    var mine = streamState;
    function drain() {
      if (mine.draining) return;
      mine.draining = true;
      (function step() {
        if (myToken !== streamToken) { mine.draining = false; queue.length = 0; return; }
        if (!queue.length) { mine.draining = false; return; }
        var item = queue.shift();
        mine.lastEventAt = Date.now();
        onEvent(item.step, item.status, item.data);
        setTimeout(step, REVEAL_PACE_MS);
      })();
    }

    es.onmessage = function (ev) {
      if (myToken !== streamToken) return;
      var data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      if (data.status === 'complete' && !data.step) {
        es.close();
        mine.closed = true;
        if (state.activeES === es) state.activeES = null;
        return;
      }
      if (!data.step) return;
      mine.lastEventAt = Date.now();
      queue.push({ step: data.step, status: data.status, data: data });
      drain();
    };
    es.onerror = function () {};
    return es;
  }

  // ---------------------------------------------------------------
  // Data loading (shared across sections)
  // ---------------------------------------------------------------
  async function loadRecords() {
    try {
      var res = await api('/api/records?limit=50');
      state.records = res.records || [];
    } catch (e) {
      state.records = [];
    }
    if (!IS_OWNER) {
      try {
        var dir = await api('/api/records/directory');
        state.otherRecords = (dir.records || []).filter(function (r) { return !r.sharedWithYou; });
      } catch (e) {
        state.otherRecords = [];
      }
    }
    renderRecordsListIfMounted();
    renderSharedListIfMounted();
    renderAccessDropdownIfMounted();
    renderOverviewIfMounted();
    renderActorsIfMounted();
  }

  async function loadAudit() {
    try {
      var res = await api('/api/logs/view?type=audit&lines=' + state.auditFilters.lines);
      // Sign-in events stay in the server's audit log; the portals show record activity.
      var AUTH_EVENTS = { LOGIN_SUCCESS: 1, LOGIN_FAILED: 1, DEMO_LOGIN: 1, LOGOUT: 1 };
      state.auditEvents = (res.logs || []).filter(function (l) { return l.event && !AUTH_EVENTS[l.event]; });
    } catch (e) {
      state.auditEvents = state.auditEvents || [];
    }
    renderAuditIfMounted();
    // Full overview re-render (not just the recent list) so the "Last
    // activity" stat card also picks up events that arrive after first paint.
    renderOverviewIfMounted();
  }

  function filteredAuditEvents() {
    var f = state.auditFilters;
    return state.auditEvents.filter(function (ev) {
      if (f.event && ev.event !== f.event) return false;
      if (f.search) {
        var hay = JSON.stringify(ev).toLowerCase();
        if (hay.indexOf(f.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------
  // Sidebar nav + actor switching
  // ---------------------------------------------------------------
  function bindSidebar() {
    var nav = $('#dashNav');
    nav.innerHTML = PORTAL_NAV.map(function (n) {
      return '<button class="dash-nav__item" data-section="' + n.id + '">' +
        '<span class="dash-nav__icon" data-icon="' + n.icon + '"></span> ' + escapeHtml(n.label) +
        (n.live ? ' <span class="dash-nav__live" id="hydraNavLive"></span>' : '') + '</button>';
    }).join('');
    $all('.dash-nav__item').forEach(function (btn) {
      btn.addEventListener('click', function () { goToSection(btn.dataset.section); });
    });
    var out = $('#signOutBtn');
    if (out) out.addEventListener('click', signOut);
  }

  function renderPortalIdentity() {
    var meta = ACTOR_META[PORTAL_ACTOR];
    $('#portalName').textContent = meta.name;
    $('#portalRole').textContent = IS_OWNER ? 'Record owner' : 'Requesting actor';
    var g = $('#portalGlyph');
    g.className = 'portal-id__glyph ' + roleAccent(PORTAL_ACTOR);
    g.setAttribute('data-icon', roleIcon(PORTAL_ACTOR));
    var chip = $('#portalChip');
    chip.className = 'portal-chip ' + roleAccent(PORTAL_ACTOR);
    chip.textContent = meta.name + ' portal';
  }

  // ---------------------------------------------------------------
  // Signed-in actors
  // ---------------------------------------------------------------
  var ROLE_SLUG = { '01': 'patient', '02': 'doctor', '03': 'hospital', '04': 'insurance' };
  function isSignedIn(actorId) { return state.sessionActors.indexOf(actorId) !== -1; }
  function loginUrlFor(actorId) { return '/login?role=' + ROLE_SLUG[actorId] + '&next=/portal/' + ROLE_SLUG[actorId]; }

  // A portal never switches actor: other actors have their own portals.
  function switchActor(actorId) {
    if (actorId !== PORTAL_ACTOR) location.assign('/portal/' + ROLE_SLUG[actorId]);
    return false;
  }

  // Signing out of a portal signs out only this actor on this browser.
  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: PORTAL_ACTOR }) });
    } catch (e) { /* ignore */ }
    location.assign(portalLoginUrl());
  }

  function goToSection(id) {
    if (id !== 'hydra') stopHydraPolling();
    state.section = id;
    $all('.dash-nav__item').forEach(function (b) { b.classList.toggle('is-active', b.dataset.section === id); });
    renderSection(id);
  }

  function renderSection(id) {
    var meta = SECTION_META[id];
    $('#topbarTitle').textContent = meta.title;
    var content = $('#dashContent');
    if (id === 'overview') renderOverview(content);
    else if (id === 'upload') renderUploadSection(content);
    else if (id === 'records') renderRecordsSection(content);
    else if (id === 'shared') renderSharedSection(content);
    else if (id === 'access') renderAccessSection(content);
    else if (id === 'hydra') renderHydraSection(content);
    else if (id === 'audit') renderAuditSection(content);
    else if (id === 'actors') renderActorsSection(content);
    injectIcons(content);
  }

  // ---------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------
  function renderOverview(content) {
    stopAuditPolling();
    var lastEvent = state.auditEvents[0];
    var meta = ACTOR_META[PORTAL_ACTOR];
    var stats;
    if (IS_OWNER) {
      var shared = state.records.filter(function (r) { return (r.wrappedActors || []).some(function (a) { return a !== '01'; }); }).length;
      var revoked = state.records.filter(function (r) { return r.status === 'revoked'; }).length;
      stats = statCard('My records', state.records.length, 'encrypted in the vault') +
        statCard('Shared', shared, 'records others can open') +
        statCard('Revoked', revoked, 'key rotated on removal') +
        statCard('Last activity', lastEvent ? timeAgo(lastEvent.timestamp) : '—', lastEvent ? prettyEvent(lastEvent.event) : 'no events yet');
    } else {
      var granted = state.auditEvents.filter(function (e) { return e.event === 'ACCESS_GRANTED'; }).length;
      var denied = state.auditEvents.filter(function (e) { return e.event === 'ACCESS_DENIED'; }).length;
      stats = statCard('Shared with me', state.records.length, 'records I can open') +
        statCard('Granted', granted, 'my access requests') +
        statCard('Refused', denied, 'my access requests') +
        statCard('Last activity', lastEvent ? timeAgo(lastEvent.timestamp) : '—', lastEvent ? prettyEvent(lastEvent.event) : 'no events yet');
    }
    content.innerHTML =
      '<div class="portal-hero ' + roleAccent(PORTAL_ACTOR) + '">' +
        '<span class="portal-hero__glyph" data-icon="' + roleIcon(PORTAL_ACTOR) + '"></span>' +
        '<div><div class="portal-hero__kicker">' + escapeHtml(meta.name) + ' portal · ' + (IS_OWNER ? 'record owner' : 'requesting actor') + '</div>' +
        '<p class="portal-hero__text">' + roleBlurb(PORTAL_ACTOR) + '</p></div>' +
      '</div>' +
      '<div class="stat-grid" id="overviewStats">' + stats + '</div>' +
      '<div class="panel">' +
        panelHeadHtml('sparkles', 'What you can do here', null, '', null) +
        '<div class="quick-actions">' +
          (IS_OWNER
            ? '<button class="btn" data-goto="upload">Upload a record</button><button class="btn btn--ghost-outline" data-goto="records">Manage who has access</button><button class="btn btn--ghost-outline" data-goto="audit">See who opened what</button>'
            : '<button class="btn" data-goto="access">Request access to a record</button><button class="btn btn--ghost-outline" data-goto="shared">Records shared with me</button><button class="btn btn--ghost-outline" data-goto="audit">My activity</button>') +
        '</div>' +
      '</div>' +
      '<div class="two-col two-col--even" style="margin-top:22px">' +
        '<div class="panel">' +
          panelHeadHtml('network', 'How my requests are checked', null, 'fastest → most authoritative', null) +
          '<div class="layer-ladder">' + layerLadderHtml() + '</div>' +
        '</div>' +
        '<div class="panel">' +
          panelHeadHtml('clipboardList', IS_OWNER ? 'Recent activity on my records' : 'My recent activity', null, 'last 5 events', null) +
          '<div id="overviewRecent"></div>' +
        '</div>' +
      '</div>';

    $all('[data-goto]', content).forEach(function (b) {
      b.addEventListener('click', function () { goToSection(b.dataset.goto); });
    });
    $all('[data-layer-goto]', content).forEach(function (b) {
      b.addEventListener('click', function () { if (IS_OWNER) goToSection('hydra'); });
    });
    renderOverviewRecentIfMounted();
    injectIcons(content);
  }
  function layerLadderHtml() {
    var layers = state.config && state.config.layers || {};
    var rows = [
      { key: 'hydra', name: 'Hydra L2', icon: 'zap', time: '~10 ms', what: 'Off-chain head snapshot' },
      { key: 'aiken', name: 'Aiken L1', icon: 'fileLock2', time: '~2 s', what: 'Plutus V3 validator' },
      { key: 'midnight', name: 'Midnight ZK', icon: 'eyeOff', time: '~1 s', what: 'Zero-knowledge proof' },
      { key: 'blockfrost', name: 'Blockfrost L1', icon: 'link2', time: '0.5–2 s', what: 'Public chain query' },
    ];
    return rows.map(function (r, i) {
      var mode = (layers[r.key] || {}).mode || '…';
      return '<div class="ladder-row"' + (r.key === 'hydra' ? ' data-layer-goto role="button" tabindex="0"' : '') + '>' +
        '<span class="ladder-row__step">' + (i + 1) + '</span>' +
        '<span class="icon-badge icon-badge--' + r.key + ' icon-badge--sm" data-icon="' + r.icon + '"></span>' +
        '<div class="ladder-row__body"><div class="ladder-row__name">' + r.name + '</div><div class="ladder-row__what">' + r.what + ' · ' + r.time + '</div></div>' +
        '<span class="mode-pill mode-pill--' + escapeHtml(mode) + '">' + escapeHtml(mode) + '</span></div>';
    }).join('');
  }
  function statCard(label, value, sub) {
    return '<div class="stat-card"><div class="stat-card__label">' + escapeHtml(label) + '</div>' +
      '<div class="stat-card__value">' + escapeHtml(value) + '</div>' +
      '<div class="stat-card__sub">' + escapeHtml(sub) + '</div></div>';
  }
  function roleBlurb(actorId) {
    return {
      '01': 'You own every record you upload. You decide who can open each one, and you are the only actor who can revoke access, which re-encrypts the file under a brand-new key.',
      '02': 'Open the records a patient has shared with you for treatment. Every request is checked through Hydra L2, Aiken L1, Midnight ZK and Blockfrost L1, and you never see who else has access.',
      '03': 'Hospital access for admissions and care coordination, limited to the records a patient has shared with the hospital. You never see who else has access.',
      '04': 'Claims verification, limited to the records a patient has explicitly shared with the insurer. Anything else is refused by the permission cascade.',
    }[actorId];
  }
  function renderOverviewIfMounted() {
    if (state.section === 'overview') renderOverview($('#dashContent'));
  }
  function renderOverviewRecentIfMounted() {
    var mount = $('#overviewRecent');
    if (!mount) return;
    var events = state.auditEvents.slice(0, 5);
    if (!events.length) { mount.innerHTML = '<p class="empty-note">No events yet.</p>'; return; }
    mount.innerHTML = events.map(auditItemHtml).join('');
  }

  // ---------------------------------------------------------------
  // Upload section
  // ---------------------------------------------------------------
  function renderUploadSection(content) {
    stopAuditPolling();
    if (state.actorId !== '01') {
      content.innerHTML = roleGateHtml('Only the Patient can upload a record.', '01');
      bindRoleGate(content);
      return;
    }
    content.innerHTML =
      '<div class="two-col">' +
        '<div class="panel">' +
          panelHeadHtml('cloudUpload', 'Upload &amp; Encrypt', null, 'as Patient', null) +
          walletWidgetHtml('01') +
          '<div class="field"><label>Patient ID</label><input type="text" id="patientIdInput" placeholder="patient-001" value="patient-001" /></div>' +
          '<div class="field"><label>Medical file</label>' +
            '<div class="dropzone" id="dropzone"><input type="file" id="fileInput" />' +
              '<div class="dropzone__title">Click or drag a file here</div>' +
              '<div class="dropzone__sub">Any file type, up to 50MB — encrypted before it ever leaves this form</div>' +
              '<div class="dropzone__file" id="fileLabel"></div></div></div>' +
          '<div class="field"><label>Grant access to</label>' +
            '<div class="grant-grid" id="grantGrid">' +
              '<span class="grant-chip is-fixed">Patient (owner)</span>' +
              '<span class="grant-chip' + (state.grantSelection['02'] ? ' is-selected' : '') + '" data-actor="02">Doctor</span>' +
              '<span class="grant-chip' + (state.grantSelection['03'] ? ' is-selected' : '') + '" data-actor="03">Hospital</span>' +
              '<span class="grant-chip' + (state.grantSelection['04'] ? ' is-selected' : '') + '" data-actor="04">Insurance</span>' +
            '</div></div>' +
          '<button class="btn btn--block" id="uploadBtn" disabled>Connect wallet &amp; choose a file</button>' +
        '</div>' +
        pipelinePanelHtml('Upload pipeline', 'waiting for a file…') +
      '</div>';

    setFlow('Upload pipeline', 'waiting for a file…', UPLOAD_FLOW);
    bindConsoleToggle(content);
    bindUploadPanel(content);
    injectIcons(content);
  }

  function bindUploadPanel(content) {
    var dz = $('#dropzone'), input = $('#fileInput'), label = $('#fileLabel'), btn = $('#uploadBtn');
    var file = null;
    function refreshGate() {
      var walletOk = !!state.walletConnected['01'];
      btn.disabled = !file || !walletOk;
      btn.textContent = !walletOk ? 'Connect wallet to continue' : !file ? 'Choose a file to continue' : 'Encrypt & Anchor';
    }
    function setFile(f) { file = f; label.textContent = f.name + ' — ' + formatBytes(f.size); refreshGate(); }
    dz.addEventListener('click', function () { input.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-dragover'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-dragover'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) setFile(f); });
    input.addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) setFile(f); });
    $all('.grant-chip[data-actor]', $('#grantGrid')).forEach(function (chip) {
      chip.addEventListener('click', function () {
        var id = chip.dataset.actor;
        state.grantSelection[id] = !state.grantSelection[id];
        chip.classList.toggle('is-selected', state.grantSelection[id]);
      });
    });
    bindWalletWidget(content, refreshGate);
    btn.addEventListener('click', function () { runUpload(file); });
    refreshGate();
  }

  async function runUpload(file) {
    if (!file) return;
    var btn = $('#uploadBtn');
    btn.disabled = true;
    var sid = sessionId();
    var actorIds = ['01'].concat(Object.keys(state.grantSelection).filter(function (id) { return state.grantSelection[id]; }));

    setFlow('Upload pipeline', 'streaming live from the server…', UPLOAD_FLOW);
    openProgressStream('encrypt', sid, function (step, status, data) {
      consoleLog(step, status, data);
      if (step === 'complete') { var h = $('#pipelineHint'); if (h) h.textContent = data.status === 'error' ? 'failed' : 'done'; return; }
      updateFlowNode(UPLOAD_FLOW, step, status, data);
    });

    var fd = new FormData();
    fd.append('file', file);
    fd.append('ownerAddr', (state.wallets['01'] && state.wallets['01'].address) || ACTOR_META['01'].addr);
    fd.append('actorIds', actorIds.join(','));
    fd.append('patientId', ($('#patientIdInput') || {}).value || 'patient-001');
    fd.append('pinToIpfs', 'true');
    fd.append('sessionId', sid);

    try {
      var res = await api('/api/encrypt/upload', { method: 'POST', body: fd });
      toast('Record encrypted & anchored — ' + shortId(res.recordId));
      await loadRecords();
      loadAudit();
      return { ok: true, data: res };
    } catch (err) {
      toast('Upload failed: ' + err.message, true);
      return { ok: false, error: err };
    } finally {
      if ($('#uploadBtn')) $('#uploadBtn').disabled = false;
    }
  }

  // ---------------------------------------------------------------
  // Shared with me (requesting actors) — the server only returns records
  // this actor holds a key for, and never the other people on the list.
  // ---------------------------------------------------------------
  function renderSharedSection(content) {
    stopAuditPolling();
    content.innerHTML =
      '<div class="panel">' +
        '<div class="panel-head"><div class="panel-head__title"><span class="icon-badge icon-badge--outline icon-badge--sm" data-icon="files"></span><h2>Records shared with me</h2></div><button class="ghost-btn" id="refreshSharedBtn" type="button">refresh</button></div>' +
        '<p class="section-note">Only records a patient has shared with the ' + escapeHtml(ACTOR_META[PORTAL_ACTOR].name) + ' appear here. Who else can open them stays private.</p>' +
        '<div class="records-list" id="sharedListMount"></div>' +
      '</div>' +
      '<div class="panel" style="margin-top:16px">' +
        '<div class="panel-head"><div class="panel-head__title"><span class="icon-badge icon-badge--outline icon-badge--sm" data-icon="lockKeyhole"></span><h2>Not shared with me</h2></div></div>' +
        '<p class="section-note">Other records in the vault. You can see that they exist, but no key was wrapped for the ' + escapeHtml(ACTOR_META[PORTAL_ACTOR].name) + ', so any attempt to open one is refused by the access cascade.</p>' +
        '<div class="records-list" id="otherListMount"></div>' +
      '</div>';
    $('#refreshSharedBtn').addEventListener('click', function () { loadRecords(); toast('Refreshed'); });
    renderSharedListIfMounted();
    injectIcons(content);
  }
  function renderSharedListIfMounted() {
    var mount = $('#sharedListMount');
    if (!mount) return;
    if (!state.records.length) { mount.innerHTML = '<p class="empty-note">Nothing has been shared with you yet.</p>'; return; }
    mount.innerHTML = state.records.map(function (r) {
      var name = (r.metadata && r.metadata.originalName) || 'untitled';
      return '<div class="record-card shared-card">' +
        '<div class="record-card__top"><span class="record-card__name">' + escapeHtml(name) + '</span><span class="record-card__status">' + escapeHtml(r.status) + '</span></div>' +
        '<div class="record-card__meta">Patient ' + escapeHtml((r.metadata && r.metadata.patientId) || '—') + ' · shared ' + timeAgo(r.createdAt) + '</div>' +
        '<button class="btn shared-card__btn" data-request="' + r.recordId + '" type="button">Request access</button>' +
      '</div>';
    }).join('');
    $all('[data-request]', mount).forEach(function (b) {
      b.addEventListener('click', function () { state.preselectRecord = b.dataset.request; goToSection('access'); });
    });
    renderOtherListIfMounted();
  }
  function renderOtherListIfMounted() {
    var mount = $('#otherListMount');
    if (!mount) return;
    if (!state.otherRecords.length) { mount.innerHTML = '<p class="empty-note">Every record in the vault is shared with you.</p>'; return; }
    mount.innerHTML = state.otherRecords.map(function (r) {
      var name = (r.metadata && r.metadata.originalName) || 'untitled';
      return '<div class="record-card shared-card shared-card--locked">' +
        '<div class="record-card__top"><span class="record-card__name">' + escapeHtml(name) + '</span><span class="record-card__status record-card__status--locked">not shared with you</span></div>' +
        '<div class="record-card__meta">Patient ' + escapeHtml((r.metadata && r.metadata.patientId) || '—') + ' · uploaded ' + timeAgo(r.createdAt) + '</div>' +
        '<button class="btn btn--ghost-outline shared-card__btn" data-try="' + r.recordId + '" type="button">Try to open</button>' +
      '</div>';
    }).join('');
    $all('[data-try]', mount).forEach(function (b) {
      b.addEventListener('click', function () { state.preselectRecord = b.dataset.try; goToSection('access'); });
    });
  }

  async function lookupPatient(patientId) {
    patientId = String(patientId || '').trim();
    if (!patientId) return [];
    try {
      var res = await api('/api/records/lookup?patientId=' + encodeURIComponent(patientId));
      state.lookupRecords = res.records || [];
      state.lookupPatient = patientId;
    } catch (e) {
      state.lookupRecords = [];
      toast('Lookup failed: ' + e.message, true);
    }
    renderAccessDropdownIfMounted();
    var note = $('#lookupNote');
    if (note) note.textContent = state.lookupRecords.length
      ? state.lookupRecords.length + ' record(s) found for ' + patientId + '. Whether you may open them is decided only when you request.'
      : 'No records found for ' + patientId + '.';
    return state.lookupRecords;
  }

  // ---------------------------------------------------------------
  // Access section
  // ---------------------------------------------------------------
  function renderAccessSection(content) {
    stopAuditPolling();
    if (state.actorId === '01') {
      content.innerHTML = roleGateHtml('The Patient owns records, not requests them. Switch to Doctor, Hospital or Insurance to try an access request.', null);
      bindRoleGate(content);
      return;
    }
    var meta = ACTOR_META[state.actorId];
    content.innerHTML =
      '<div class="two-col">' +
        '<div class="panel">' +
          panelHeadHtml('shieldCheck', 'Request Access', null, 'as ' + meta.name, null) +
          walletWidgetHtml(state.actorId) +
          '<div class="field"><label>Find a patient\'s records</label><div class="lookup-row"><input type="text" id="lookupInput" placeholder="Patient ID, e.g. patient-001" value="' + escapeHtml(state.lookupPatient) + '" /><button class="ghost-btn" id="lookupBtn" type="button">look up</button></div><div class="field-hint" id="lookupNote"></div></div>' +
          '<div class="field"><label>Record</label><select id="recordSelect"><option value="">Select a record…</option>' + recordOptions() + '</select></div>' +
          '<button class="btn btn--block" id="requestBtn" disabled>Connect wallet &amp; choose a record</button>' +
          '<div class="divider-note">This walks the real 4-layer permission cascade on the server. Whichever layer actually grants access — Hydra, Aiken, Midnight or Blockfrost — will be highlighted.</div>' +
          '<div id="unlockArea"></div>' +
        '</div>' +
        pipelinePanelHtml('Permission cascade', 'waiting for a request…') +
      '</div>';

    setFlow('Permission cascade', 'waiting for a request…', ACCESS_FLOW);
    bindConsoleToggle(content);
    var sel = $('#recordSelect'), btn = $('#requestBtn');
    function refreshGate() {
      var walletOk = !!state.walletConnected[state.actorId];
      btn.disabled = !sel.value || !walletOk;
      btn.textContent = !walletOk ? 'Connect wallet to continue' : !sel.value ? 'Choose a record to continue' : 'Request Access';
    }
    sel.addEventListener('change', function () { $('#unlockArea').innerHTML = ''; refreshGate(); });
    $('#lookupBtn').addEventListener('click', function () { lookupPatient($('#lookupInput').value).then(refreshGate); });
    $('#lookupInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); lookupPatient($('#lookupInput').value).then(refreshGate); } });
    if (state.preselectRecord) { sel.value = state.preselectRecord; state.preselectRecord = ''; }
    bindWalletWidget(content, refreshGate);
    btn.addEventListener('click', function () { runAccessRequest(sel.value); });
    refreshGate();
    injectIcons(content);
  }

  function recordOptions() {
    function opt(r) {
      var name = (r.metadata && r.metadata.originalName) || r.recordId;
      return '<option value="' + r.recordId + '">' + escapeHtml(name) + ' — ' + escapeHtml((r.metadata && r.metadata.patientId) || '') + ' (' + shortId(r.recordId) + ')</option>';
    }
    var sharedIds = {};
    state.records.forEach(function (r) { sharedIds[r.recordId] = true; });
    var extra = state.lookupRecords.filter(function (r) { return !sharedIds[r.recordId]; });
    var seen = {};
    extra.forEach(function (r) { seen[r.recordId] = true; });
    var others = state.otherRecords.filter(function (r) { return !sharedIds[r.recordId] && !seen[r.recordId]; });
    var html = '';
    if (state.records.length) html += '<optgroup label="Shared with me">' + state.records.map(opt).join('') + '</optgroup>';
    if (extra.length) html += '<optgroup label="Found by patient lookup">' + extra.map(opt).join('') + '</optgroup>';
    if (others.length) html += '<optgroup label="Not shared with me (will be refused)">' + others.map(opt).join('') + '</optgroup>';
    return html;
  }
  function renderAccessDropdownIfMounted() {
    var sel = $('#recordSelect');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">Select a record…</option>' + recordOptions();
    if (current) sel.value = current;
  }

  async function runAccessRequest(recordId) {
    if (!recordId) return;
    var btn = $('#requestBtn');
    btn.disabled = true;
    var sid = sessionId();
    var meta = ACTOR_META[state.actorId];

    setFlow('Permission cascade', 'checking layers in order of speed → authority…', ACCESS_FLOW);
    openProgressStream('access', sid, function (step, status, data) {
      var layerKey = step.indexOf('layer:') === 0 ? step.slice(6) : step;
      consoleLog(layerKey, status, data);
      if (step === 'complete') {
        var h = $('#pipelineHint');
        if (h) h.textContent = 'resolved via ' + (data.source || '?') + ' in ' + (data.verificationTime || '?') + 'ms';
        return;
      }
      updateFlowNode(ACCESS_FLOW, layerKey, status, data);
    });

    try {
      var signed = await signWithWallet(state.actorId, 'accessRequest', recordId, { actorId: state.actorId });
      var res = await api('/api/access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: recordId, actorId: state.actorId, actorAddr: signed.address, actorSignature: signed.signature, timestamp: signed.timestamp, sessionId: sid }),
      });
      toast('Access granted via ' + res.verificationMethod + ' — wrapped key handed to the client');
      var area = $('#unlockArea');
      if (area) {
        area.innerHTML = '<button class="btn btn--block" id="unlockBtn" type="button" style="margin-top:14px">' +
          '<span data-icon="lockKeyhole" style="width:16px;height:16px;display:inline-flex"></span> Unlock &amp; decrypt this file</button>';
        injectIcons(area);
        $('#unlockBtn').addEventListener('click', function () { runUnlock(recordId, state.actorId); });
      }
      loadAudit();
      return { ok: true, data: res };
    } catch (err) {
      toast('Access denied for the ' + meta.name + ': ' + err.message, true);
      var denyArea = $('#unlockArea');
      if (denyArea) {
        denyArea.innerHTML = '<div class="deny-card"><span class="icon-badge icon-badge--sm deny-card__icon" data-icon="xCircle"></span>' +
          '<div><div class="deny-card__title">Access denied for the ' + escapeHtml(meta.name) + '</div><div class="deny-card__meta">' + escapeHtml(err.message) + '</div></div></div>';
        injectIcons(denyArea);
      }
      loadAudit();
      return { ok: false, error: err };
    } finally {
      if ($('#requestBtn')) $('#requestBtn').disabled = false;
    }
  }

  // ---------------------------------------------------------------
  // Unlock — actually unwraps the CEK and decrypts server-side, handing
  // the browser the real plaintext (see POST /api/encrypt/unlock).
  // ---------------------------------------------------------------
  async function runUnlock(recordId, actorId) {
    var area = $('#unlockArea');
    var meta = ACTOR_META[actorId];
    if (area) area.innerHTML = '<p class="empty-note">Unwrapping key and decrypting on the server…</p>';
    try {
      var signed = await signWithWallet(actorId, 'unlock', recordId, { actorId: actorId });
      var res = await fetch('/api/encrypt/unlock', withPortalHeader({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: recordId, actorId: actorId, actorAddr: signed.address, actorSignature: signed.signature, timestamp: signed.timestamp }),
      }));
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || (res.status + ' ' + res.statusText));
      }
      var verificationMethod = res.headers.get('X-Verification-Method') || '?';
      var disposition = res.headers.get('Content-Disposition') || '';
      var filenameMatch = disposition.match(/filename="([^"]*)"/);
      var filename = filenameMatch ? filenameMatch[1] : 'record';
      var mimeType = (res.headers.get('Content-Type') || 'application/octet-stream').split(';')[0];
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var isText = mimeType.indexOf('text/') === 0 || mimeType === 'application/json';
      var text = isText ? await blob.text() : null;

      if (area) {
        area.innerHTML =
          '<div class="unlock-result">' +
            '<div class="unlock-result__head">' +
              '<span class="icon-badge icon-badge--dark icon-badge--sm" data-icon="checkCircle2"></span>' +
              '<div><div class="unlock-result__title">' + escapeHtml(filename) + '</div>' +
              '<div class="unlock-result__meta">' + escapeHtml(mimeType) + ' &middot; verified via ' + escapeHtml(verificationMethod) + '</div></div>' +
            '</div>' +
            '<a class="btn btn--block" href="' + url + '" download="' + escapeHtml(filename) + '">' +
              '<span data-icon="download" style="width:16px;height:16px;display:inline-flex"></span> Download decrypted file</a>' +
            (isText ? '<pre class="unlock-preview" id="unlockPreview"></pre>' : '') +
          '</div>';
        injectIcons(area);
        var p = $('#unlockPreview');
        if (p) p.textContent = text.slice(0, 2000) + (text.length > 2000 ? '\n…' : '');
      }
      toast('Decrypted for ' + meta.name + ' — ' + filename);
      loadAudit();
      return { ok: true, filename: filename, mimeType: mimeType, text: text };
    } catch (err) {
      if (area) area.innerHTML = '<p class="empty-note">Unlock failed: ' + escapeHtml(err.message) + '</p>';
      toast('Unlock failed: ' + err.message, true);
      return { ok: false, error: err };
    }
  }

  // ---------------------------------------------------------------
  // Records section
  // ---------------------------------------------------------------
  function renderRecordsSection(content) {
    stopAuditPolling();
    content.innerHTML =
      '<div class="stack">' +
        '<div class="panel">' +
          '<div class="panel-head"><div class="panel-head__title"><span class="icon-badge icon-badge--outline icon-badge--sm" data-icon="files"></span><h2>Vault Records</h2></div><button class="ghost-btn" id="refreshRecordsBtn" type="button">refresh</button></div>' +
          '<div class="records-toolbar"><div class="field"><input type="search" id="recordSearch" placeholder="Search by filename or patient ID…" /></div></div>' +
          '<div class="records-list" id="recordsListMount"></div>' +
        '</div>' +
        pipelinePanelHtml('CEK rotation', 'revoke an actor above to watch this run live') +
      '</div>';

    setFlow('CEK rotation', 'revoke an actor above to watch this run live', REVOKE_FLOW);
    bindConsoleToggle(content);
    $('#refreshRecordsBtn').addEventListener('click', function () { loadRecords(); toast('Records refreshed'); });
    $('#recordSearch').addEventListener('input', function () { renderRecordsListIfMounted(); });
    renderRecordsListIfMounted();
  }

  function renderRecordsListIfMounted() {
    var mount = $('#recordsListMount');
    if (!mount) return;
    var q = (($('#recordSearch') || {}).value || '').toLowerCase();
    var records = state.records.filter(function (r) {
      if (!q) return true;
      var name = ((r.metadata && r.metadata.originalName) || '').toLowerCase();
      var pid = ((r.metadata && r.metadata.patientId) || '').toLowerCase();
      return name.indexOf(q) !== -1 || pid.indexOf(q) !== -1 || r.recordId.toLowerCase().indexOf(q) !== -1;
    });
    if (!records.length) { mount.innerHTML = '<p class="empty-note">' + (state.records.length ? 'No records match your search.' : 'No records yet — upload one as Patient to get started.') + '</p>'; return; }
    mount.innerHTML = '';
    records.forEach(function (r) {
      var card = el('div', 'record-card');
      var name = (r.metadata && r.metadata.originalName) || 'untitled';
      var actors = r.wrappedActors || [];
      card.innerHTML =
        '<div class="record-card__top"><span class="record-card__name">' + escapeHtml(name) + '</span><span class="record-card__status">' + escapeHtml(r.status) + '</span></div>' +
        '<div class="record-card__meta">' + shortId(r.recordId) + ' · ' + escapeHtml((r.metadata && r.metadata.patientId) || '—') + ' · ' + formatBytes(r.metadata && r.metadata.encryptedSize) + '</div>' +
        '<div class="record-card__actors">' + actors.map(function (a) { return '<span class="mini-pill ' + roleAccent(a) + '" title="' + ACTOR_META[a].name + ' has access">' + ACTOR_META[a].name[0] + '</span>'; }).join('') + '</div>' +
        '<div class="record-card__detail">' +
          (state.actorId === '01' ? revokeControlsHtml(r) : '') +
          '<pre>' + escapeHtml(JSON.stringify(r, null, 2)) + '</pre>' +
        '</div>';
      card.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.revoke-btn')) return;
        card.classList.toggle('is-open');
      });
      $all('.revoke-btn', card).forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); runRevoke(r.recordId, b.dataset.actor); });
      });
      mount.appendChild(card);
    });
  }

  function revokeControlsHtml(r) {
    var actors = (r.wrappedActors || []).filter(function (a) { return a !== '01'; });
    if (!actors.length) return '<p class="empty-note" style="margin-top:0">No revocable actors on this record.</p>';
    return '<div class="field" style="margin-top:0;margin-bottom:14px"><label>Revoke access (triggers CEK rotation)</label>' +
      '<div class="grant-grid">' + actors.map(function (a) { return '<span class="grant-chip revoke-btn" data-actor="' + a + '">✕ ' + ACTOR_META[a].name + '</span>'; }).join('') + '</div></div>';
  }

  async function runRevoke(recordId, actorId) {
    var sid = sessionId();
    setFlow('CEK rotation', 'revoking ' + ACTOR_META[actorId].name + ' — server is streaming each step…', REVOKE_FLOW);
    openProgressStream('revoke', sid, function (step, status, data) {
      var nodeKey = step.indexOf('rotate:') === 0 ? step.slice(7) : step;
      consoleLog(nodeKey, status, data);
      if (step === 'complete') { var h = $('#pipelineHint'); if (h) h.textContent = 'rotation ' + (data.rotationStatus || 'done'); return; }
      updateFlowNode(REVOKE_FLOW, nodeKey, status, data);
    });
    try {
      var signed = await signWithWallet('01', 'revoke', recordId, { actorId: actorId });
      var res = await api('/api/encrypt/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: recordId, actorId: actorId, ownerAddr: signed.address, ownerSignature: signed.signature, timestamp: signed.timestamp, sessionId: sid }),
      });
      toast(res.message + ' — ' + res.rotation.status);
      await loadRecords();
      loadAudit();
      return { ok: true, data: res };
    } catch (err) {
      toast('Revoke failed: ' + err.message, true);
      return { ok: false, error: err };
    }
  }

  // ---------------------------------------------------------------
  // Audit Log section — the real thing, not a stub
  // ---------------------------------------------------------------
  function renderAuditSection(content) {
    content.innerHTML =
      '<div class="panel">' +
        panelHeadHtml('clipboardList', 'Audit Log', null, 'HIPAA/GDPR-aligned', null) +
        '<div class="audit-toolbar">' +
          '<div class="field field--grow"><label>Search</label><input type="search" id="auditSearch" placeholder="record ID, actor, method…" /></div>' +
          '<div class="field"><label>Event</label><select id="auditEventFilter"><option value="">All events</option>' +
            Object.keys(EVENT_LABELS).map(function (k) { return '<option value="' + k + '">' + EVENT_LABELS[k] + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label>Show</label><select id="auditLines"><option value="50">Last 50</option><option value="100">Last 100</option><option value="200">Last 200</option></select></div>' +
          '<button class="ghost-btn" id="auditRefreshBtn" type="button">refresh</button>' +
          '<button class="ghost-btn" id="auditAutoBtn" type="button">auto-refresh: off</button>' +
        '</div>' +
        '<div class="audit-stat-row" id="auditStats"></div>' +
        '<div class="audit-table" id="auditTable"></div>' +
      '</div>';

    $('#auditSearch').value = state.auditFilters.search;
    $('#auditEventFilter').value = state.auditFilters.event;
    $('#auditLines').value = String(state.auditFilters.lines);

    $('#auditSearch').addEventListener('input', function (e) { state.auditFilters.search = e.target.value; renderAuditIfMounted(); });
    $('#auditEventFilter').addEventListener('change', function (e) { state.auditFilters.event = e.target.value; renderAuditIfMounted(); });
    $('#auditLines').addEventListener('change', function (e) { state.auditFilters.lines = parseInt(e.target.value, 10); loadAudit(); });
    $('#auditRefreshBtn').addEventListener('click', function () { loadAudit(); toast('Audit log refreshed'); });
    $('#auditAutoBtn').addEventListener('click', function () { toggleAuditPolling(); });

    renderAuditIfMounted();
    if (state.auditTimer) $('#auditAutoBtn').classList.add('is-active'), ($('#auditAutoBtn').textContent = 'auto-refresh: on');
  }

  function renderAuditIfMounted() {
    var table = $('#auditTable'), stats = $('#auditStats');
    if (!table) return;
    var events = filteredAuditEvents();

    var granted = state.auditEvents.filter(function (e) { return e.result === true; }).length;
    var denied = state.auditEvents.filter(function (e) { return e.result === false; }).length;
    stats.innerHTML =
      auditStatHtml('Total events', state.auditEvents.length) +
      auditStatHtml('Granted', granted) +
      auditStatHtml('Denied', denied) +
      auditStatHtml('Showing', events.length);

    if (!events.length) { table.innerHTML = '<p class="empty-note">No matching events.</p>'; return; }
    table.innerHTML = events.map(function (ev) {
      var detailBits = [];
      if (ev.recordId) detailBits.push(shortId(ev.recordId));
      if (ev.actorId) detailBits.push('actor ' + ev.actorId);
      if (ev.method) detailBits.push(ev.method);
      if (ev.rotationStatus) detailBits.push('rotation: ' + ev.rotationStatus);
      var resultBadge = '';
      if (typeof ev.result === 'boolean') {
        resultBadge = '<span class="audit-row__result audit-row__result--' + (ev.result ? 'granted' : 'denied') + '">' + (ev.result ? 'granted' : 'denied') + '</span>';
      } else {
        resultBadge = '<span></span>';
      }
      return '<div class="audit-row">' +
        '<span class="audit-row__time">' + escapeHtml(timeAgo(ev.timestamp)) + '</span>' +
        '<span><span class="audit-row__event">' + escapeHtml(prettyEvent(ev.event)) + '</span><div class="audit-row__detail">' + escapeHtml(detailBits.join(' · ')) + '</div></span>' +
        '<span class="audit-row__detail">' + escapeHtml(ev.requestId || '') + '</span>' +
        resultBadge +
      '</div>';
    }).join('');
  }
  function auditStatHtml(label, value) {
    return '<div class="audit-stat"><div class="audit-stat__label">' + escapeHtml(label) + '</div><div class="audit-stat__value">' + value + '</div></div>';
  }
  function auditItemHtml(ev) {
    var detailBits = [];
    if (ev.recordId) detailBits.push(shortId(ev.recordId));
    if (ev.actorId) detailBits.push('actor ' + ev.actorId);
    if (ev.method) detailBits.push(ev.method);
    return '<div class="audit-item"><div class="audit-item__top"><span class="audit-item__event">' + escapeHtml(prettyEvent(ev.event)) + '</span>' +
      '<span class="audit-item__time">' + escapeHtml(timeAgo(ev.timestamp)) + '</span></div>' +
      '<div class="audit-item__detail">' + escapeHtml(detailBits.join(' · ')) + '</div></div>';
  }
  function prettyEvent(e) {
    return EVENT_LABELS[e] || String(e || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function toggleAuditPolling() {
    var btn = $('#auditAutoBtn');
    if (state.auditTimer) {
      stopAuditPolling();
    } else {
      state.auditTimer = setInterval(loadAudit, 4500);
      if (btn) { btn.classList.add('is-active'); btn.textContent = 'auto-refresh: on'; }
    }
  }
  function stopAuditPolling() {
    if (state.auditTimer) { clearInterval(state.auditTimer); state.auditTimer = null; }
    var btn = $('#auditAutoBtn');
    if (btn) { btn.classList.remove('is-active'); btn.textContent = 'auto-refresh: off'; }
  }

  // ---------------------------------------------------------------
  // Actors section
  // ---------------------------------------------------------------
  function renderActorsSection(content) {
    stopAuditPolling();
    content.innerHTML = '<div class="actor-card-grid" id="actorCardGrid"></div>';
    renderActorsIfMounted();
  }
  function renderActorsIfMounted() {
    var grid = $('#actorCardGrid');
    if (!grid) return;
    grid.innerHTML = Object.keys(ACTOR_META).map(function (id) {
      var m = ACTOR_META[id];
      var count = state.records.filter(function (r) { return (r.wrappedActors || []).indexOf(id) !== -1; }).length;
      return '<div class="actor-card">' +
        '<div class="actor-card__top"><span class="actor-card__glyph ' + roleAccent(id) + '" data-icon="' + roleIcon(id) + '"></span>' +
          '<div><div class="actor-card__name">' + escapeHtml(m.name) + '</div><div class="actor-card__role">' + escapeHtml(m.role) + '</div></div></div>' +
        '<div class="actor-card__addr">' + escapeHtml(m.addr) + '</div>' +
        '<div class="actor-card__records">' + count + ' record' + (count === 1 ? '' : 's') + ' accessible</div>' +
      '</div>';
    }).join('');
    injectIcons(grid);
  }

  // ---------------------------------------------------------------
  // Hydra L2 section — live head view (real node, or the in-process
  // simulator with synthetic traffic when no node is reachable)
  // ---------------------------------------------------------------
  var UPDATE_TYPE_LABEL = { SHARE_RECORD: 'share', GRANT_ACTOR: 'grant', REVOKE_ACTOR: 'revoke' };

  function renderHydraSection(content) {
    stopAuditPolling();
    content.innerHTML =
      '<div class="hydra-banner" id="hydraBanner"></div>' +
      '<div class="stat-grid" id="hydraStats">' +
        statCard('Head', '…', 'connecting') + statCard('Epoch', '…', '') + statCard('Avg confirm', '…', '') + statCard('Tx / minute', '…', '') +
      '</div>' +
      '<div class="two-col two-col--even">' +
        '<div class="panel">' +
          panelHeadHtml('activity', 'Live snapshot feed', null, 'newest first', 'hydraFeedHint', 'icon-badge--hydra') +
          '<div class="snap-feed" id="snapFeed"><p class="empty-note">Loading head state…</p></div>' +
        '</div>' +
        '<div class="stack">' +
          '<div class="panel">' +
            panelHeadHtml('penLine', 'Head parties', null, 'Ed25519 multi-sig', null) +
            '<div class="party-list" id="partyList"></div>' +
          '</div>' +
          '<div class="panel">' +
            '<div class="panel-head"><div class="panel-head__title"><span class="icon-badge icon-badge--outline icon-badge--sm" data-icon="gauge"></span><h2>L2 vs L1 lookup time</h2></div>' +
            '<button class="ghost-btn" id="benchBtn" type="button">run benchmark</button></div>' +
            '<div class="bench" id="benchMount"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    injectIcons(content);
    $('#benchBtn').addEventListener('click', runBenchmark);
    renderBenchmark();
    loadHydra();
    stopHydraPolling();
    state.hydraTimer = setInterval(loadHydra, 2500);
  }

  function stopHydraPolling() {
    if (state.hydraTimer) { clearInterval(state.hydraTimer); state.hydraTimer = null; }
  }

  async function loadHydra() {
    try {
      state.hydra = await api('/api/hydra/status');
    } catch (e) {
      state.hydra = { error: e.message };
    }
    renderHydraIfMounted();
    updateHydraNavBadge();
  }

  function updateHydraNavBadge() {
    var badge = $('#hydraNavLive');
    if (!badge || !state.hydra || state.hydra.error) return;
    badge.textContent = 'e' + state.hydra.epoch;
  }

  function renderHydraIfMounted() {
    var feed = $('#snapFeed');
    if (!feed) return;
    var h = state.hydra;
    if (!h) return;
    if (h.error) { feed.innerHTML = '<p class="empty-note">Hydra head unavailable: ' + escapeHtml(h.error) + '</p>'; return; }

    var sim = h.mode === 'simulated';
    $('#hydraBanner').innerHTML =
      '<span class="mode-tag mode-tag--' + (sim ? 'sim' : 'live') + '">' + (sim ? 'Simulated head' : 'Hydra node') + '</span>' +
      '<span>' + (sim
        ? 'No hydra-node is reachable from this deployment, so an in-process head runs instead. Head state, consensus delay and the background traffic (patients PT-xxxx) are <strong>synthetic</strong>; every snapshot is still signed by all four parties with real Ed25519 keys and re-verified on each read. Your own uploads are real records.'
        : 'Connected to the Hydra node at ' + escapeHtml(h.headId) + '.') + '</span>';

    $('#hydraStats').innerHTML =
      statCard('Head', String(h.status || '—').toUpperCase(), shortId(h.headId)) +
      statCard('Epoch', h.epoch, (h.totals && h.totals.snapshots) + ' snapshots total') +
      statCard('Avg confirm', h.stats && h.stats.avgConfirmMs != null ? h.stats.avgConfirmMs + ' ms' : '—', 'multi-party consensus') +
      statCard('Tx / minute', h.stats && h.stats.txLastMinute != null ? h.stats.txLastMinute : '—', (h.totals && h.totals.realRecords) + ' real · ' + (h.totals && h.totals.syntheticRecords) + ' synthetic records');

    var parties = $('#partyList');
    if (parties) {
      parties.innerHTML = (h.parties || []).map(function (p) {
        return '<div class="party-row"><span class="actor-row__glyph ' + roleAccent(p.id) + '" data-icon="' + roleIcon(p.id) + '"></span>' +
          '<div class="party-row__body"><div class="party-row__name">' + escapeHtml(p.name) + '</div>' +
          '<div class="party-row__key">' + escapeHtml(p.publicKey ? p.publicKey.slice(0, 20) + '…' : '') + '</div></div>' +
          '<span class="sig-ok' + (h.latestVerified ? '' : ' sig-ok--bad') + '">' + (h.latestVerified ? '✓ signed' : '× invalid') + '</span></div>';
      }).join('') || '<p class="empty-note">Party list not exposed by this node.</p>';
      injectIcons(parties);
    }

    var firstLoad = !Object.keys(state.hydraSeen).length;
    feed.innerHTML = (h.snapshots || []).map(function (s) {
      var isNew = !firstLoad && !state.hydraSeen[s.snapshotId];
      state.hydraSeen[s.snapshotId] = true;
      var title = s.synthetic ? escapeHtml(s.label || 'synthetic record') : recordTitle(s.recordId);
      return '<div class="snap-row' + (s.synthetic ? '' : ' snap-row--real') + (isNew ? ' is-new' : '') + '">' +
        '<span class="snap-row__epoch">#' + s.epoch + '</span>' +
        '<div class="snap-row__body">' +
          '<div class="snap-row__title"><span class="type-tag type-tag--' + escapeHtml(UPDATE_TYPE_LABEL[s.updateType] || 'share') + '">' + escapeHtml(UPDATE_TYPE_LABEL[s.updateType] || s.updateType || '?') + '</span>' + title +
            (s.synthetic ? '<span class="syn-tag">synthetic</span>' : '<span class="real-tag">real</span>') + '</div>' +
          '<div class="snap-row__meta">' + (s.permittedActors || []).map(function (a) {
              return '<span class="mini-pill mini-pill--xs ' + roleAccent(a) + '" title="' + (ACTOR_META[a] ? ACTOR_META[a].name : a) + '">' + (ACTOR_META[a] ? ACTOR_META[a].name[0] : '?') + '</span>';
            }).join('') +
            '<span>' + (s.confirmMs != null ? s.confirmMs + ' ms' : '') + '</span>' +
            (s.signatures ? '<span>' + s.signatures + '/4 sigs</span>' : '') +
            '<span>' + escapeHtml(timeAgo(s.acceptedAt)) + '</span></div>' +
        '</div></div>';
    }).join('') || '<p class="empty-note">No snapshots yet.</p>';
  }

  function recordTitle(recordId) {
    var r = state.records.filter(function (x) { return x.recordId === recordId; })[0];
    var name = r && r.metadata && r.metadata.originalName;
    return escapeHtml(name || ('record ' + shortId(recordId)));
  }

  async function runBenchmark() {
    var btn = $('#benchBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'running…'; }
    try {
      state.benchmark = await api('/api/hydra/benchmark', { method: 'POST' });
    } catch (e) {
      toast('Benchmark failed: ' + e.message, true);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'run again'; }
    renderBenchmark();
  }

  function renderBenchmark() {
    var mount = $('#benchMount');
    if (!mount) return;
    var b = state.benchmark;
    var rows = [];
    if (b) {
      var m = b.measured || {};
      if (m.hydraSnapshotInMemory) rows.push({ label: 'Hydra L2 · in-memory snapshot', ms: m.hydraSnapshotInMemory.avgMs, kind: 'hydra', measured: true });
      if (m.hydraSnapshotMongo) rows.push({ label: 'Hydra L2 · stored snapshot (MongoDB)', ms: m.hydraSnapshotMongo.avgMs, kind: 'hydra', measured: true });
      rows.push({ label: 'Midnight ZK proof', ms: b.reference.midnightZk.typicalMs, kind: 'midnight' });
      rows.push({ label: 'Blockfrost L1 query', ms: b.reference.blockfrostL1.typicalMs, kind: 'blockfrost' });
      rows.push({ label: 'Aiken L1 (block time)', ms: b.reference.aikenL1.typicalMs, kind: 'aiken' });
    }
    if (!rows.length) {
      mount.innerHTML = '<p class="empty-note">Times real permission lookups on this server and compares them with typical L1 round trips.</p>';
      return;
    }
    // Log scale so sub-millisecond and 2-second bars are both visible.
    var maxLog = Math.log10(3000), minLog = Math.log10(0.0001);
    mount.innerHTML = rows.map(function (r) {
      var pct = Math.max(3, ((Math.log10(Math.max(r.ms, 0.0001)) - minLog) / (maxLog - minLog)) * 100);
      return '<div class="bench-row"><div class="bench-row__label">' + escapeHtml(r.label) +
        '<span class="bench-row__tag">' + (r.measured ? 'measured' : 'reference') + '</span></div>' +
        '<div class="bench-row__track"><span class="bench-row__bar" style="width:' + pct.toFixed(1) + '%;background:var(--color-' + r.kind + ')"></span></div>' +
        '<div class="bench-row__ms">' + formatMs(r.ms) + '</div></div>';
    }).join('') + '<p class="bench-note">Log scale. Measured rows are timed on this server right now; reference rows are typical published values.</p>';
  }

  function formatMs(ms) {
    if (ms < 0.01) return (ms * 1000).toFixed(2) + ' µs';
    if (ms < 10) return ms.toFixed(2) + ' ms';
    return Math.round(ms) + ' ms';
  }

  // ---------------------------------------------------------------
  // Top bar — live mode of every layer, straight from /api/config
  // ---------------------------------------------------------------
  function renderLayerStrip(cfg) {
    var strip = $('#layerStrip');
    if (!strip || !cfg || !cfg.layers) return;
    var order = [['hydra', 'Hydra'], ['aiken', 'Aiken'], ['midnight', 'Midnight'], ['blockfrost', 'Blockfrost'], ['ipfs', 'IPFS']];
    strip.innerHTML = order.map(function (pair) {
      var mode = (cfg.layers[pair[0]] || {}).mode || 'off';
      var cls = mode === 'live' ? 'live' : (mode === 'mock' || mode === 'simulated') ? 'mock' : 'off';
      return '<span class="layer-chip layer-chip--' + cls + '" title="' + escapeHtml(pair[1] + ': ' + mode) + '"><span class="layer-chip__dot" style="background:var(--color-' + (pair[0] === 'ipfs' ? 'brand' : pair[0]) + ')"></span>' + escapeHtml(pair[1]) + '<em>' + escapeHtml(mode) + '</em></span>';
    }).join('');
  }

  // ---------------------------------------------------------------
  // Shared partial templates
  // ---------------------------------------------------------------
  function pipelinePanelHtml(title, hint) {
    return '<div class="panel">' +
      panelHeadHtml('activity', escapeHtml(title), 'pipelineTitle', hint, 'pipelineHint') +
      '<div class="flow" id="flow"></div>' +
      '<div class="console" aria-label="Backend log">' +
        '<button class="console__bar" id="consoleToggle" type="button" aria-expanded="false">' +
          '<span class="console__dot-group"><span class="console__dot"></span><span class="console__dot"></span><span class="console__dot"></span></span>' +
          '<span class="console__headline" id="consoleHeadline">Waiting for activity…</span>' +
          '<span class="console__count" id="consoleCount"></span>' +
          '<span class="console__chevron" data-icon="chevronRight"></span>' +
        '</button>' +
        '<div class="console__body" id="consoleBody" hidden><span class="console__idle">// full log with record IDs and access points appears here</span></div>' +
      '</div>' +
    '</div>';
  }
  function roleGateHtml(message, switchTo) {
    return '<div class="panel"><div class="role-note"><strong>Heads up —</strong>&nbsp;' + escapeHtml(message) + '</div>' +
      (switchTo ? '<a class="btn" href="/portal/' + ROLE_SLUG[switchTo] + '">Open the ' + escapeHtml(ACTOR_META[switchTo].name) + ' portal</a>' : '') +
    '</div>';
  }
  function bindRoleGate(content) {
    $all('[data-switch-actor]', content).forEach(function (b) {
      b.addEventListener('click', function () { switchActor(b.dataset.switchActor); });
    });
  }

  // ---------------------------------------------------------------
  // Wallet-connect widget (placeholder for real CIP-30 / Eternl —
  // DEMO_MODE bypasses signature verification server-side; this exists
  // so the demo has an explicit "connect before you can sign" moment).
  // ---------------------------------------------------------------
  function walletWidgetHtml(actorId) {
    var meta = ACTOR_META[actorId];
    var connected = !!state.walletConnected[actorId];
    if (connected) {
      var wallet = state.wallets[actorId] || {};
      return '<div class="wallet-box wallet-box--connected" id="walletBox">' +
        '<span class="icon-badge ' + roleAccent(actorId) + ' icon-badge--sm" data-icon="wallet"></span>' +
        '<div class="wallet-box__body">' +
          '<div class="wallet-box__addr">' + escapeHtml(shortAddr(wallet.address || meta.addr)) + '</div>' +
          '<div class="wallet-box__hint">' + (wallet.demo ? 'demo wallet &middot; DEMO_MODE' : (wallet.balanceAda || '0.00') + ' ADA &middot; connected') + '</div>' +
        '</div>' +
        '<button class="ghost-btn" data-wallet-disconnect="' + actorId + '" type="button">disconnect</button>' +
      '</div>';
    }
    return '<div class="wallet-box" id="walletBox">' +
      '<span class="icon-badge icon-badge--outline icon-badge--sm" data-icon="wallet"></span>' +
      '<div class="wallet-box__body">' +
        '<div class="wallet-box__addr">Wallet not connected</div>' +
      '</div>' +
      '<button class="btn" style="width:auto;padding:10px 18px;font-size:13px" data-wallet-connect="' + actorId + '" type="button">Connect Wallet</button>' +
    '</div>';
  }

  function bindWalletWidget(root, onChange) {
    var connectBtn = $('[data-wallet-connect]', root);
    if (connectBtn) {
      connectBtn.addEventListener('click', function () {
        var actorId = connectBtn.dataset.walletConnect;
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting…';
        connectRealWallet(actorId).then(function (wallet) {
          toast(ACTOR_META[actorId].name + (wallet.demo ? ' demo wallet connected (no Eternl found)' : ' wallet connected — ' + shortAddr(wallet.address)));
          var box = $('#walletBox', root);
          if (box) { box.outerHTML = walletWidgetHtml(actorId); bindWalletWidget(root, onChange); }
          if (onChange) onChange();
        }).catch(function (err) {
          toast('Wallet connect failed: ' + err.message, true);
          connectBtn.disabled = false;
          connectBtn.textContent = 'Connect Wallet';
        });
      });
    }
    var disconnectBtn = $('[data-wallet-disconnect]', root);
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', function () {
        var actorId = disconnectBtn.dataset.walletDisconnect;
        disconnectRealWallet(actorId);
        var box = $('#walletBox', root);
        if (box) { box.outerHTML = walletWidgetHtml(actorId); bindWalletWidget(root, onChange); }
        if (onChange) onChange();
      });
    }
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async function () {
    // The server only serves a portal to a signed-in actor; this covers expiry.
    try {
      var sess = await api('/api/auth/session');
      state.sessionActors = sess.actors || [];
    } catch (e) { state.sessionActors = []; }
    if (!isSignedIn(PORTAL_ACTOR)) { location.assign(portalLoginUrl()); return; }

    bindSidebar();
    renderPortalIdentity();
    injectIcons(document);
    $('.dash-nav__item[data-section="overview"]').classList.add('is-active');
    loadRecords();
    loadAudit();
    renderSection('overview');
    api('/api/config').then(function (cfg) {
      SERVER_DEMO_MODE = !!cfg.demoMode;
      if (cfg.network) CARDANO_NETWORK_LABEL = cfg.network;
      state.config = cfg;
      renderLayerStrip(cfg);
      renderOverviewIfMounted();
    }).catch(function () { /* keep defaults */ });
    if (IS_OWNER) loadHydra();
  });

  // Hooks for the guided demo (public/present.js), which drives each portal through the same
  // functions the buttons call, so everything it shows is the real backend.
  window.VaultDash = {
    state: state,
    goToSection: goToSection,
    isSignedIn: isSignedIn,
    loginUrlFor: loginUrlFor,
    actorId: PORTAL_ACTOR,
    setActor: function (actorId) {
      if (actorId !== PORTAL_ACTOR) throw new Error('This is the ' + ACTOR_META[PORTAL_ACTOR].name + ' portal');
    },
    lookupPatient: lookupPatient,
    selectRecord: function (recordId) {
      var sel = $('#recordSelect');
      if (sel) { sel.value = recordId; sel.dispatchEvent(new Event('change')); }
      else state.preselectRecord = recordId;
    },
    renderSection: renderSection,
    connectDemoWallet: function (actorId) { return connectDemoWallet(actorId); },
    isDemoMode: function () { return SERVER_DEMO_MODE; },
    runUpload: runUpload,
    runAccessRequest: runAccessRequest,
    runUnlock: runUnlock,
    runRevoke: runRevoke,
    runBenchmark: runBenchmark,
    waitForStream: waitForStream,
    loadRecords: loadRecords,
    loadAudit: loadAudit,
    loadHydra: loadHydra,
    toast: toast,
  };
})();
