"use strict";

// Shared pure helpers for the Auto Refresh extension.
//
// Loading strategy (documented choice):
// - Firefox MV3 `background.scripts` is a classic (non-module) scripts
//   array, so `utils.js` is loaded first via
//   `"background": { "scripts": ["utils.js", "background.js"] }` and the
//   popup loads it via `<script src="utils.js">` before `popup.js`.
// - To stay compatible with both the extension (no modules) and `node`
//   unit tests, this file exposes its API on `globalThis.AutoRefreshUtils`
//   AND via `module.exports` when running under node (CommonJS).
// - Callers use `globalThis.AutoRefreshUtils` in the extension and
//   `require("../utils.js")` in tests.

const MAX_INTERVAL_SECS = 86400; // 24h — well below setTimeout 2^31-1 ms overflow

// Allowlist: only http(s) pages can be auto-refreshed. Everything else
// (about:, moz-extension:, chrome:, view-source:, data:, file:, blob:, …)
// is rejected. Denylists drift; an allowlist fails closed.
function isRefreshableUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Page identity deliberately ignores the hash so hash-based SPA
// navigation (and in-page anchors) don't count as leaving the page.
function pageKeyForUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return String(url || "").split("#")[0];
  }
}

function hostForUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Compact badge text: 45 -> "45s", 90 -> "2m", 3600 -> "1h".
function badgeText(seconds) {
  const secs = Math.floor(Number(seconds));
  if (!Number.isFinite(secs)) return "";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs / 3600)}h`;
}

// Human-readable interval for popup status text.
function fmtInterval(secs) {
  const n = Math.floor(Number(secs));
  if (!Number.isFinite(n)) return "";
  if (n < 60) return `${n}s`;
  if (n < 3600) {
    const m = n / 60;
    return Number.isInteger(m) ? `${m} min` : `${n}s`;
  }
  const h = n / 3600;
  return Number.isInteger(h) ? `${h} hr` : `${Math.round((h + Number.EPSILON) * 100) / 100} hr`;
}

// Clamp a raw interval to [1, MAX_INTERVAL_SECS]. Throws on non-numeric
// input so callers can show a validation error instead of silently
// starting a wrong timer.
function clampInterval(seconds) {
  const secs = Math.floor(Number(seconds));
  if (!Number.isFinite(secs)) throw new Error("Invalid interval");
  if (secs < 1) return 1;
  if (secs > MAX_INTERVAL_SECS) return MAX_INTERVAL_SECS;
  return secs;
}

const AutoRefreshUtils = {
  MAX_INTERVAL_SECS,
  isRefreshableUrl,
  pageKeyForUrl,
  hostForUrl,
  badgeText,
  fmtInterval,
  clampInterval,
};

globalThis.AutoRefreshUtils = AutoRefreshUtils;

if (typeof module !== "undefined" && module.exports) {
  module.exports = AutoRefreshUtils;
}
