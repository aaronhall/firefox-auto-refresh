# Tab Auto Reload — Per-Tab Timer (Firefox)

Auto-reload the current tab at a custom interval. Timers belong to a single
tab only — they never leak into other tabs — and die with the tab. An optional
scope lock auto-cancels the timer when the tab navigates away.

## Scopes (default: Tab)

- **Tab** — no lock. Keeps refreshing this tab even if you navigate elsewhere.
- **Page** — locked to the page (URL minus `#hash`). Auto-cancels when the tab
  leaves the page. Hash-only changes (anchors, hash-based SPA routes) don't
  count as leaving.
- **Domain** — locked to the hostname. Auto-cancels when the tab leaves the site.

## Features

- Popup with **Tab / Page / Domain radio** (default Tab), live target label
  (full URL vs page URL vs hostname)
- Interval input in **seconds** + one-click presets: **1 / 5 / 15 / 30 / 60 min**
- Second-precision scheduling via background `setTimeout` + `tabs.reload`
  (alarms would clamp to ≥30s, so they're intentionally not used)
- Toolbar badge shows the active interval (`45s`, `5m`, `1h`)
- No persisted rules, no cross-tab side effects, no `storage` permission —
  popup talks to the background via `runtime.sendMessage`

## Permissions rationale (least privilege)

- `tabs` — required to read the active tab URL (scope locks), call
  `tabs.reload(tabId)` for the owning tab, and set per-tab action
  icon/badge state. No tab content is read.
- No `host_permissions` — deliberately omitted. `tabs.reload()` does not need
  host access, so the extension requests no `<all_urls>` access and injects
  no content scripts.

## Privacy

No data collection, no analytics, no network requests. Timers and cancel
notices live only in background memory (`Map<tabId, …>`) and are cleared when
the tab closes, the timer stops, or the browser restarts. Nothing is written
to `storage`, cookies, or disk.

## Known limits

- Timers are **in-memory only**: they die with the tab, on browser restart,
  on extension reload/update, and if the MV3 background context is suspended
  or throttled. Badges are reset best-effort on startup/install so a stale
  interval badge is never left showing for a dead timer.
- MV3 background throttling can delay `setTimeout` under memory pressure.
  For intervals ≥30s the `alarms` API would survive suspension, but it clamps
  to ≥30s, so this extension intentionally uses `setTimeout` for
  second-precision and documents the tradeoff.
- Interval range is **1 second – 24 hours (86400s)**. The upper bound also
  avoids `setTimeout` 2³¹-1 ms overflow. Minimum of 1s is enforced, but
  30s+ is kinder to servers — please don't hammer dashboards at 1s.
- Only `http:`/`https:` pages are refreshable (allowlist, fails closed).
  `about:*`, `moz-extension:*`, `view-source:*`, `data:`, `file:`, etc.
  disable the popup.
- Page identity strips the `#hash`; query strings count as part of the page.

## Project layout

```
manifest.json    MV3 manifest (tabs permission only, no host permissions)
utils.js         shared pure helpers (isRefreshableUrl, pageKeyForUrl, …)
background.js    Map<tabId, {seconds, scope, pageKey, host}> + auto-cancel on navigation
popup.html       Tab/Page/Domain radio, target label, seconds input, presets, Start/Stop
popup.js         reads active tab, get/start/stop timer via runtime messages
popup.css        Photon-ish light/dark styling (+ :has/color-mix fallbacks)
tests/           node:test unit tests for utils.js
icons/           extension icons (SVG)
```

## Install temporarily (development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` in this folder
4. Open any `http(s)` page, click the toolbar button, pick a scope + interval

## Develop / test / lint

Requires Node ≥18 (no dependencies).

```sh
npm test   # node --test tests/ — pure-helper unit tests
npm run lint  # node --check on utils.js, background.js, popup.js
npx web-ext lint  # optional: Mozilla add-on linter (needs network install)
```

## Notes

- `about:*`, `moz-extension:*`, `view-source:*`, etc. can't be refreshed — the popup disables itself there
- Minimum interval is 1s; for heavy dashboards 30s+ is kinder to servers
- Page identity strips the `#hash`; query strings count as part of the page

## License

Mozilla Public License 2.0 — see `LICENSE`.
