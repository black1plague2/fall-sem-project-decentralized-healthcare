/* Cardano Healthcare Vault — landing page
 * Only job: pull real system status from the backend so the "what's live
 * vs. mocked" claims on this page are never stale copy.
 */
(function () {
  'use strict';

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

  async function loadStatus() {
    var row = $('#statusRow');
    try {
      var res = await fetch('/api/config');
      var cfg = await res.json();
      var order = [
        ['encryption', 'Encryption'],
        ['ipfs', 'IPFS'],
        ['hydra', 'Hydra L2'],
        ['aiken', 'Aiken L1'],
        ['midnight', 'Midnight ZK'],
        ['blockfrost', 'Blockfrost L1'],
      ];
      row.innerHTML = '';
      order.forEach(function (pair) {
        var layer = cfg.layers[pair[0]] || {};
        var mode = layer.mode || 'off';
        var cls = mode === 'live' ? 'status-pill--live' : mode === 'mock' ? 'status-pill--mock' : 'status-pill--off';
        row.appendChild(el('span', 'status-pill ' + cls, escapeHtml(pair[1]) + ' — ' + escapeHtml(mode)));
      });
      if (cfg.demoMode) row.appendChild(el('span', 'status-pill status-pill--mock', 'demo mode'));

      $all('[data-layer]').forEach(function (n) {
        var layer = cfg.layers[n.dataset.layer] || {};
        n.textContent = (layer.mode || 'off').toUpperCase();
      });
    } catch (e) {
      row.innerHTML = '<span class="status-pill status-pill--off">status unavailable</span>';
    }
  }

  function injectIcons() {
    if (!window.VaultIcons) return;
    $all('[data-icon]').forEach(function (n) {
      var size = n.classList.contains('icon-badge--lg') ? 30 : n.classList.contains('icon-badge--md') ? 24 : n.classList.contains('icon-badge--sm') ? 18 : 20;
      n.innerHTML = window.VaultIcons.icon(n.dataset.icon, { size: size });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectIcons();
    loadStatus();
    $all('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var target = document.querySelector(a.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
})();
