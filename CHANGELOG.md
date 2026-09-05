# Changelog

## Unreleased — review hardening

### Fixed
- `manifest.json`: removed `host_permissions: ["<all_urls>"]` (unneeded for
  `tabs.reload`); extension now requests `tabs` only.
- `background.js` / `popup.js`: use `globalThis.browser ?? globalThis.chrome`
  (bare `chrome` threw `ReferenceError` where undefined).
- `background.js`: cap intervals at 24h (`MAX_INTERVAL_SECS = 86400`) to avoid
  `setTimeout` 2³¹-1 ms overflow turning huge inputs into a rapid-reload loop;
  `startTimer` rejects over-max with a clear error.
- `background.js`: reset icon/badge on reload failure so a dead timer can't
  leave a stuck active badge.
- `background.js`: `tabs.onReplaced` migrates timers/notices across tab-id
  swaps (prerender / session-restore); `onStartup`/`onInstalled` reset badges
  best-effort; `recentCancels` gets TTL (10 min) + LRU cap (50) + periodic
  pruning.
- `background.js`: validate `tabId` on every message, allowlist refreshable
  URLs to `http:`/`https:` only (fails closed), `console.warn` instead of
  silent catches.
- `popup.js` / `popup.html`: `type="button"` on all buttons, initially-disabled
  Start/Stop, null-tab guards, double-submit guard on Start, `max="86400"` +
  `inputmode="numeric"` on the interval input, shared `clampInterval` /
  `fmtInterval` via `utils.js`.
- `popup.html`: status region gets `role="status"` + `aria-live="polite"`.
- `popup.css`: plain-color fallbacks for `color-mix` (pre-FF 113) and a
  `.selected` fallback class for `:has()` (pre-FF 121); `:focus-visible`
  styles; removed dead `.summary` rule.
- New `utils.js` shared module (extension `globalThis` + node CommonJS) and
  `tests/utils.test.js` (`node:test`, 13 assertions).

## v1.1

- Per-tab timers with Tab / Page / Domain scope locks, card UI, per-tab icon
  states (idle / active / cancelled) and consumable cancel notices.

## v1.0

- Initial Firefox auto-refresh extension with per-page/domain timers.
