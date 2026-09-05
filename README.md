# Auto Refresh — Per-Tab Timer (Firefox)

Auto-refresh the current tab at a custom interval. Timers belong to a single
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
- Toolbar badge shows the active interval (`45s`, `5m`, `2h`)
- No persisted rules, no cross-tab side effects, no `storage` permission —
  popup talks to the background via `runtime.sendMessage`

## Project layout

```
manifest.json    MV3 manifest (tabs permission, persistent background scripts)
background.js    Map<tabId, {seconds, scope, pageKey, host}> + auto-cancel on navigation
popup.html       Tab/Page/Domain radio, target label, seconds input, presets, Start/Stop
popup.js         reads active tab, get/start/stop timer via runtime messages
popup.css        Photon-ish light/dark styling
icons/           extension icons (SVG)
```

## Install temporarily (development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` in this folder
4. Open any `http(s)` page, click the toolbar button, pick a scope + interval

## Notes

- `about:*`, `moz-extension:*`, `view-source:*`, etc. can't be refreshed — the popup disables itself there
- Minimum interval is 1s; for heavy dashboards 30s+ is kinder to servers
- Page identity strips the `#hash`; query strings count as part of the page
