// demoController.js
const { logger } = require('../services/auditLogger');

/**
 * GET /demo
 * Serves the HTML page. No inline scripts—only an external script loaded from /demo-script.js
 */
function getDemoPage(req, res) {
  try {
    logger && logger.info && logger.info('demo_page_access', { path: req.path || req.url || '/' });
  } catch (e) {
    // safe fallback
    // eslint-disable-next-line no-console
    console.warn('logger.info failed', e && e.message);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Encryption Demo</title>
<style>
  /* Minimal, functional styling (inline styles are OK unless style-src blocks them) */
  :root{
    --bg:#0f1724;
    --card:#0b1220;
    --accent1:#6c5ce7;
    --accent2:#00b4d8;
    --ok:#16a34a;
    --err:#ef4444;
    --muted:#94a3b8;
    --white:#eef2ff;
  }
  html,body{height:100%;margin:0;background:linear-gradient(180deg,var(--bg),#081226);color:var(--white);font-family:system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial;}
  .wrap{max-width:980px;margin:24px auto;padding:18px;background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01));border-radius:10px;box-shadow:0 6px 20px rgba(2,6,23,0.6);}
  h1{margin:0 0 12px;font-size:18px}
  .top{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .drop{flex:1;min-width:260px;border:2px dashed rgba(255,255,255,0.06);padding:14px;border-radius:8px;background:linear-gradient(90deg, rgba(255,255,255,0.01), rgba(255,255,255,0.005));cursor:pointer}
  .drop.hover{border-color:rgba(255,255,255,0.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.02)}
  .drop input{display:none}
  .meta{min-width:260px;padding:8px}
  .actors{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}
  .actor{padding:10px 12px;border-radius:8px;background:var(--card);cursor:pointer;user-select:none;border:1px solid rgba(255,255,255,0.02);font-size:13px}
  .actor.selected{outline:2px solid rgba(108,92,231,0.18);box-shadow:0 6px 18px rgba(12,10,30,0.6)}
  .btn{display:inline-block;padding:8px 12px;border-radius:8px;border:0;background:linear-gradient(90deg,var(--accent1),var(--accent2));cursor:pointer;color:#001119;font-weight:600}
  .steps{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
  .step{padding:10px;border-radius:8px;background:#071225;border:1px solid rgba(255,255,255,0.02);font-size:13px;min-height:72px;display:flex;flex-direction:column;justify-content:space-between}
  .step .label{font-weight:700;margin-bottom:6px}
  .state{font-size:12px;padding:6px;border-radius:6px;text-align:center}
  .state.running{background:rgba(99,102,241,0.12);color:var(--accent1)}
  .state.ok{background:rgba(22,163,74,0.12);color:var(--ok)}
  .state.err{background:rgba(239,68,68,0.12);color:var(--err)}
  .state.idle{background:transparent;color:var(--muted)}
  .small{font-size:12px;color:var(--muted)}
  .success{margin-top:12px;padding:10px;border-radius:8px;background:linear-gradient(180deg,rgba(2,6,23,0.6),rgba(2,6,23,0.4));border:1px solid rgba(108,92,231,0.08);display:none}
  .success.visible{display:block}
  pre{white-space:pre-wrap;font-family:monospace;font-size:13px;color:var(--muted);margin:4px 0 0}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .muted{color:var(--muted)}
  .smallbtn{padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.04);background:transparent;color:var(--white);cursor:pointer}
  footer{margin-top:14px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
  <div class="wrap" role="main">
    <div class="top">
      <div style="flex:1">
        <h1>Encryption </h1>
        <div class="actors" id="actors">
          <div class="actor" data-id="patient">Patient</div>
          <div class="actor" data-id="doctor">Doctor</div>
          <div class="actor" data-id="hospital">Hospital</div>
          <div class="actor" data-id="insurance">Insurance</div>
        </div>

        <div class="drop" id="dropzone" tabindex="0" aria-label="File upload area">
          <div id="dropmsg">Click or drag a file here to upload</div>
          <input id="fileinput" type="file" />
          <div class="small muted" id="filestat" style="margin-top:8px">No file selected</div>
        </div>

        <div style="margin-top:10px" class="row">
          <button id="encryptBtn" class="btn">Encrypt & Upload</button>
          <button id="clearBtn" class="smallbtn">Clear</button>
          <div class="small muted" id="ownerInfo" style="margin-left:auto">ownerAddr: <span id="ownerAddr">-</span></div>
        </div>
      </div>

      <div class="meta" style="min-width:260px">
        <div class="small muted">Selected owner (first selected actor used as ownerId):</div>
        <div id="selectedList" class="small" style="margin:8px 0">None</div>

        <div class="small muted">Upload options</div>
        <div style="margin-top:6px">
          <label class="small muted"><input id="pinIpfs" type="checkbox" checked /> Pin to IPFS</label>
        </div>

        <div style="margin-top:12px" class="small muted">Quick actions</div>
        <div style="margin-top:8px">
          <button id="genAddr" class="smallbtn">Generate ownerAddr</button>
        </div>
      </div>
    </div>

    <div class="steps" id="steps" style="margin-top:14px">
      <div class="step" data-step="1">
        <div class="label">Step 1: File Validation</div>
        <div class="state idle" id="s1">idle</div>
        <div class="small muted">Checks file presence and size</div>
      </div>
      <div class="step" data-step="2">
        <div class="label">Step 2: Generate AES-256 Key</div>
        <div class="state idle" id="s2">idle</div>
        <div class="small muted">Derive CEK (simulated)</div>
      </div>
      <div class="step" data-step="3">
        <div class="label">Step 3: AES-GCM Encryption</div>
        <div class="state idle" id="s3">idle</div>
        <div class="small muted">Encrypt file with AES-GCM (simulated)</div>
      </div>
      <div class="step" data-step="4">
        <div class="label">Step 4: IPFS Upload</div>
        <div class="state idle" id="s4">idle</div>
        <div class="small muted">POST file to /api/encrypt/upload</div>
      </div>
      <div class="step" data-step="5">
        <div class="label">Step 5: Key Wrapping</div>
        <div class="state idle" id="s5">idle</div>
        <div class="small muted">Wrap AES key for authorized actors</div>
      </div>
    </div>

    <div class="success" id="successBox" role="status" aria-live="polite">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>Result</strong>
        <button id="copyBtn" class="smallbtn">Copy JSON</button>
      </div>
      <pre id="resultJson">No result yet</pre>
    </div>

    <footer>Note: This demo simulates cryptographic operations in the browser and posts the encrypted blob to <code>/api/encrypt/upload</code>. Do not use in production.</footer>
  </div>

  <!-- External script loaded from same origin (allowed by script-src 'self') -->
  <script src="/demo-script.js" defer></script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

/**
 * GET /demo-script.js
 * Serves the external JavaScript for the demo page.
 * This function returns a JS string (no inline execution required).
 */
function getDemoScript(req, res) {
  // JS content string (keeps same logic as previous inline script).
  // Note: keep this a plain JS file (no template literal placeholders).
  const js = `/* demo-script.js - served from /demo-script.js (same-origin) */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    try {
      console.log('[demo] DOM ready');
      const actorsEl = document.getElementById('actors');
      if (!actorsEl) { console.warn('[demo] actors container missing'); return; }
      const actorEls = Array.from(actorsEl.querySelectorAll('.actor'));
      const selected = new Set();
      const selectedListEl = document.getElementById('selectedList');
      const drop = document.getElementById('dropzone');
      const fileInput = document.getElementById('fileinput');
      const filestat = document.getElementById('filestat');
      const encryptBtn = document.getElementById('encryptBtn');
      const clearBtn = document.getElementById('clearBtn');
      const genAddrBtn = document.getElementById('genAddr');
      const ownerAddrEl = document.getElementById('ownerAddr');
      const pinIpfsEl = document.getElementById('pinIpfs');
      const steps = {
        1: document.getElementById('s1'),
        2: document.getElementById('s2'),
        3: document.getElementById('s3'),
        4: document.getElementById('s4'),
        5: document.getElementById('s5')
      };
      const successBox = document.getElementById('successBox');
      const resultJsonEl = document.getElementById('resultJson');
      const copyBtn = document.getElementById('copyBtn');

      if (!encryptBtn || !clearBtn || !genAddrBtn) {
        console.warn('[demo] one of main buttons missing', { encryptBtn: !!encryptBtn, clearBtn: !!clearBtn, genAddrBtn: !!genAddrBtn });
      }

      let currentFile = null;
      let ownerAddr = null;

      function updateSelectedUI(){
        if(selected.size === 0){
          selectedListEl.textContent = 'None';
        } else {
          selectedListEl.textContent = Array.from(selected).join(', ');
        }
      }

      actorEls.forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id');
          if(selected.has(id)){
            selected.delete(id);
            el.classList.remove('selected');
          } else {
            selected.add(id);
            el.classList.add('selected');
          }
          updateSelectedUI();
        });
      });

      function prevent(e){ e.preventDefault(); e.stopPropagation(); }
      ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => { prevent(e); drop.classList.add('hover'); }));
      ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => { prevent(e); drop.classList.remove('hover'); }));
      drop.addEventListener('drop', (e) => {
        prevent(e);
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if(f) setFile(f);
      });
      drop.addEventListener('click', () => fileInput && fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if(f) setFile(f);
      });

      function setFile(f){
        currentFile = f;
        filestat.textContent = f.name + ' — ' + f.type + ' — ' + f.size + ' bytes';
        console.log('[demo] file selected', f.name, f.size);
      }

      clearBtn.addEventListener('click', () => {
        currentFile = null;
        if (fileInput) fileInput.value = '';
        if (filestat) filestat.textContent = 'No file selected';
        resetSteps();
        successBox.classList.remove('visible');
        resultJsonEl.textContent = 'No result yet';
        console.log('[demo] cleared');
      });

      genAddrBtn.addEventListener('click', () => {
        ownerAddr = generateHex(40);
        ownerAddrEl.textContent = ownerAddr;
        console.log('[demo] ownerAddr generated', ownerAddr);
      });

      copyBtn.addEventListener('click', () => {
        try {
          navigator.clipboard.writeText(resultJsonEl.textContent || '');
          copyBtn.textContent = 'Copied';
          setTimeout(() => copyBtn.textContent = 'Copy JSON', 1500);
        } catch (e) {
          copyBtn.textContent = 'Copy failed';
          setTimeout(() => copyBtn.textContent = 'Copy JSON', 1500);
        }
      });

      window._demoFallback = {};
      window._demoFallback.generateAddr = () => genAddrBtn && genAddrBtn.click();
      window._demoFallback.clear = () => clearBtn && clearBtn.click();

      if (encryptBtn) encryptBtn.onclick = encryptBtn.onclick || (() => { encryptBtn.dispatchEvent(new Event('click')); });
      if (clearBtn) clearBtn.onclick = clearBtn.onclick || (() => { clearBtn.dispatchEvent(new Event('click')); });
      if (genAddrBtn) genAddrBtn.onclick = genAddrBtn.onclick || (() => { genAddrBtn.dispatchEvent(new Event('click')); });

      function generateHex(len){
        try {
          const arr = new Uint8Array(len/2);
          crypto.getRandomValues(arr);
          return Array.from(arr).map(b => ('0' + b.toString(16)).slice(-2)).join('');
        } catch (e) {
          let s = '';
          for(let i=0;i<len;i++){
            s += '0123456789abcdef'[Math.floor(Math.random()*16)];
          }
          return s;
        }
      }

      function setStepState(n, stateText, cls){
        const el = steps[n];
        if(!el) return;
        el.textContent = stateText;
        el.className = 'state ' + cls;
      }

      function resetSteps(){
        for(let i=1;i<=5;i++){
          setStepState(i, 'idle', 'idle');
        }
      }

      resetSteps();

      async function simulateGenerateKey(){
        setStepState(2, 'running', 'running');
        await wait(300 + Math.random()*700);
        setStepState(2, 'complete', 'ok');
        return generateHex(64);
      }

      async function simulateEncrypt(file){
        setStepState(3, 'running', 'running');
        await wait(400 + Math.random()*900);
        const arr = await file.arrayBuffer();
        const header = new TextEncoder().encode('ENCRYPTED-DEMO-');
        const combined = new Uint8Array(header.byteLength + arr.byteLength);
        combined.set(header, 0);
        combined.set(new Uint8Array(arr), header.byteLength);
        setStepState(3, 'complete', 'ok');
        return new Blob([combined], { type: 'application/octet-stream' });
      }

      async function simulateWrapKey(key, actorIds){
        setStepState(5, 'running', 'running');
        await wait(200 + Math.random()*600);
        const wrapped = actorIds.map(a => ({actor:a, wrappedKey: 'wrap-' + key.slice(0,8) + '-' + a}));
        setStepState(5, 'complete', 'ok');
        return wrapped;
      }

      async function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

      async function runUpload(encryptedBlob, formData){
        setStepState(4, 'running', 'running');
        try {
          const resp = await fetch('/api/encrypt/upload', {
            method: 'POST',
            body: formData
          });
          if(!resp.ok){
            const txt = await resp.text().catch(()=>null);
            setStepState(4, 'error', 'err');
            throw new Error('Upload failed: ' + (txt || resp.status));
          }
          const json = await resp.json().catch(()=>null);
          setStepState(4, 'complete', 'ok');
          return json;
        } catch (err) {
          setStepState(4, 'error', 'err');
          throw err;
        }
      }

      async function doEncryptFlow() {
        try {
          successBox.classList.remove('visible');
          resultJsonEl.textContent = 'No result yet';
          resetSteps();

          setStepState(1, 'running', 'running');
          await wait(120);
          if(!currentFile){
            setStepState(1, 'error', 'err');
            alert('Please select a file first.');
            return;
          }
          if(currentFile.size > 200 * 1024 * 1024){
            setStepState(1, 'error', 'err');
            alert('File too large for demo (200MB limit).');
            return;
          }
          setStepState(1, 'complete', 'ok');

          const actors = Array.from(selected);
          if(actors.length === 0){
            alert('Select at least one actor (Patient/Doctor/Hospital/Insurance).');
            return;
          }
          const ownerId = actors[0];
          if(!ownerAddr){
            ownerAddr = generateHex(40);
            ownerAddrEl.textContent = ownerAddr;
          }

          let cek = await simulateGenerateKey();
          let encryptedBlob = await simulateEncrypt(currentFile);
          let wrappedKeys = await simulateWrapKey(cek, actors);

          const fd = new FormData();
          fd.append('file', encryptedBlob, currentFile.name + '.enc');
          fd.append('ownerId', ownerId);
          fd.append('ownerAddr', ownerAddr);
          fd.append('actorIds', actors.join(','));
          fd.append('pinToIpfs', pinIpfsEl.checked ? 'true' : 'false');
          fd.append('wrappedKeys', JSON.stringify(wrappedKeys));
          fd.append('origFileName', currentFile.name);
          fd.append('origFileSize', String(currentFile.size));
          fd.append('contentType', encryptedBlob.type || 'application/octet-stream');

          let serverResp = null;
          try {
            serverResp = await runUpload(encryptedBlob, fd);
          } catch (err) {
            const info = {
              error: String(err && err.message ? err.message : err),
              ownerId,
              ownerAddr,
              actorIds: actors,
              wrappedKeys,
              encryptedSize: encryptedBlob.size,
              originalSize: currentFile.size
            };
            resultJsonEl.textContent = JSON.stringify(info, null, 2);
            successBox.classList.add('visible');
            console.error('[demo] upload error', err);
            return;
          }

          const result = {
            recordId: serverResp && serverResp.recordId ? serverResp.recordId : 'demo-record-' + generateHex(6),
            ipfsCid: serverResp && serverResp.cid ? serverResp.cid : serverResp && serverResp.ipfsCid ? serverResp.ipfsCid : 'bafy-demo-' + generateHex(8),
            encryptedSize: encryptedBlob.size,
            originalSize: currentFile.size,
            ownerId,
            ownerAddr,
            actorIds: actors,
            wrappedKeys,
            serverResponse: serverResp
          };
          successBox.classList.add('visible');
          resultJsonEl.textContent = JSON.stringify(result, null, 2);
          console.log('[demo] upload success', result);
        } catch (e) {
          console.error('[demo] unexpected error in flow', e);
          alert('Unexpected error: ' + (e && e.message ? e.message : String(e)));
        }
      }

      if (encryptBtn) {
        encryptBtn.addEventListener('click', (ev) => {
          ev && ev.preventDefault && ev.preventDefault();
          doEncryptFlow();
        });
        encryptBtn.onclick = encryptBtn.onclick || (() => { doEncryptFlow(); });
      } else {
        console.warn('[demo] encryptBtn missing');
      }

      ownerAddr = generateHex(40);
      ownerAddrEl.textContent = ownerAddr;

      console.log('[demo] initialization complete');
    } catch (outerErr) {
      console.error('[demo] initialization failed', outerErr);
    }
  });
})();
`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // optional: small cache for same-origin script
  res.setHeader('Cache-Control', 'no-cache');
  res.send(js);
}

module.exports = { getDemoPage, getDemoScript };
