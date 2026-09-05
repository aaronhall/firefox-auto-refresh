# Auto Refresh — Page & Domain Timer (Firefox)

Auto-refreshes pages at custom intervals. Set a timer for a single **page**
(exact URL, hash ignored) or a whole **domain**. Page timers take precedence
over domain timers when both exist.

## Features

- Popup with **Page / Domain radio**, live target label (full URL vs hostname)
- Interval input in **seconds** + one-click presets: **1 / 5 / 15 / 30 / 60 min**
- Second-precision scheduling via background `setTimeout` + `tabs.reload`
  (alarms would clamp to ≥30s, so they're intentionally not used)
- Toolbar badge shows the active interval (`45s`, `5m`, `2h`)
- Timers survive navigation and browser restart

## Project layout

```
manifest.json    MV3 manifest (gecko id, tabs+storage, persistent background scripts)
background.js    per-tab scheduler, badge updates, storage/tab listeners
popup.html       Page/Domain radio, target label, seconds input, presets, Start/Stop
popup.js         reads active tab, loads/saves pageRules + domainRules in storage.local
popup.css        Photon-ish light/dark styling
icons/           extension icons (SVG)
```

Storage shape in `storage.local`:

```json
{
  "pageRules":   { "https://example.com/a?x=1": 60 },
  "domainRules": { "example.com": 300 }
}
```

## Install temporarily (development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` in this folder
4. Pin the toolbar button, open any `http(s)` page, click it to set a timer

## Use

1. Click the toolbar icon on any page
2. Pick **Page** (this exact URL) or **Domain** (`example.com`)
3. Type seconds or tap a preset (1/5/15/30/60 min)
4. **Start** to save, **Stop** to clear that scope's timer
5. The summary line shows both timers; badge shows the effective one

## Notes

- `about:*`, `moz-extension:*`, `view-source:*`, etc. can't be refreshed — the popup disables itself there
- Minimum interval is 1s; for heavy dashboards 30s+ is kinder to servers
- Page match strips the `#hash`; query strings are part of the page key
