// Per-tab auto-reload scheduler.
//
// Timers belong to a single tabId only — they never leak to other tabs.
// Scope is purely an auto-cancel guard evaluated on navigation:
//   tab    = no lock, follows the tab anywhere
//   page   = cancels when the tab leaves the locked page (hash ignored)
//   domain = cancels when the tab leaves the locked hostname
//
// Icon states (per tab):
//   idle      = gray icon, no badge
//   active    = blue icon + interval badge (blue)
//   cancelled = gray icon + yellow "!" badge; reason waits for the popup
//               (option-1 passive notice) and is consumed on popup open.
//
// Second-precision via setTimeout + tabs.reload (alarms clamp to >= 30s,
// so they're intentionally not used). Timers live in memory and die with
// the tab / browser session — nothing is persisted.
const api = globalThis.browser ?? globalThis.chrome;

// Shared pure helpers live in utils.js (loaded first via manifest
// background.scripts). Fall back to node require when running tests.
const Utils =
  globalThis.AutoRefreshUtils ??
  (typeof require === "function" ? require("./utils.js") : null);
if (!Utils) throw new Error("AutoRefreshUtils not loaded (utils.js missing)");
const { MAX_INTERVAL_SECS, isRefreshableUrl, pageKeyForUrl, hostForUrl, badgeText } = Utils;

// Auto-cancel notices expire so the map can't grow without bound when the
// popup is never reopened for a tab.
const RECENT_CANCEL_TTL_MS = 10 * 60 * 1000;
const RECENT_CANCEL_MAX = 50;

// tabId -> { timeoutId, seconds, scope, pageKey, host }
const timers = new Map();

// tabId -> { scope, seconds, host, pageKey, at } (unseen auto-cancel notices)
const recentCancels = new Map();

const ICON_IDLE = { 48: "icons/icon-48-gray.svg", 96: "icons/icon-96-gray.svg" };
const ICON_ACTIVE = { 48: "icons/icon-48.svg", 96: "icons/icon-96.svg" };

function isValidTabId(tabId) {
  return Number.isInteger(tabId) && tabId > 0;
}

function pruneRecentCancels(now = Date.now()) {
  for (const [tabId, info] of recentCancels) {
    if (!info || now - info.at > RECENT_CANCEL_TTL_MS) {
      recentCancels.delete(tabId);
    }
  }
  while (recentCancels.size > RECENT_CANCEL_MAX) {
    const oldest = recentCancels.keys().next().value;
    if (oldest === undefined) break;
    recentCancels.delete(oldest);
  }
}

function delayMsForSeconds(seconds) {
  const secs = Math.floor(Number(seconds));
  if (!Number.isFinite(secs) || secs < 1) return 1000;
  return Math.min(secs, MAX_INTERVAL_SECS) * 1000;
}

async function setIcon(tabId, active) {
  try {
    await api.action.setIcon({ tabId, path: active ? ICON_ACTIVE : ICON_IDLE });
  } catch (e) {
    console.warn("setIcon failed (tab may be gone):", e);
  }
}

async function showActive(tabId, seconds) {
  await setIcon(tabId, true);
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: "#0074e8" });
    await api.action.setBadgeText({ tabId, text: badgeText(seconds) });
  } catch (e) {
    console.warn("showActive badge failed (tab may be gone):", e);
  }
}

async function showIdle(tabId) {
  await setIcon(tabId, false);
  try {
    await api.action.setBadgeText({ tabId, text: "" });
  } catch (e) {
    console.warn("showIdle badge failed (tab may be gone):", e);
  }
}

async function showCancelled(tabId) {
  await setIcon(tabId, false);
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: "#e07f00" });
    await api.action.setBadgeText({ tabId, text: "!" });
  } catch (e) {
    console.warn("showCancelled badge failed (tab may be gone):", e);
  }
}

/**
 * @param {number} tabId
 * @param {{ scope, seconds, host, pageKey } | null} autoCancel
 *   Pass the timer's lock info when the scope guard fires so the popup
 *   can explain why; null for manual stops / supersedes.
 */
async function stopTimer(tabId, autoCancel = null) {
  if (!isValidTabId(tabId)) return;
  const st = timers.get(tabId);
  if (st) clearTimeout(st.timeoutId);
  timers.delete(tabId);
  if (autoCancel) {
    pruneRecentCancels();
    recentCancels.set(tabId, { ...autoCancel, at: Date.now() });
    pruneRecentCancels();
    await showCancelled(tabId);
  } else {
    recentCancels.delete(tabId);
    await showIdle(tabId);
  }
}

function lockInfo(state) {
  return { scope: state.scope, seconds: state.seconds, host: state.host, pageKey: state.pageKey };
}

function armTimer(tabId, state) {
  return setTimeout(async () => {
    const cur = timers.get(tabId);
    if (!cur) return;
    try {
      const tab = await api.tabs.get(tabId);
      // Re-validate scope right before firing (covers races with navigation).
      if (cur.scope === "page" && pageKeyForUrl(tab.url) !== cur.pageKey) {
        await stopTimer(tabId, lockInfo(cur));
        return;
      }
      if (cur.scope === "domain" && hostForUrl(tab.url) !== cur.host) {
        await stopTimer(tabId, lockInfo(cur));
        return;
      }
      await api.tabs.reload(tabId);
    } catch (e) {
      // Tab closed or reload rejected — drop the timer and reset the badge
      // so it can't get stuck showing an active interval for a dead timer.
      console.warn(`timer for tab ${tabId} dropped:`, e);
      timers.delete(tabId);
      recentCancels.delete(tabId);
      await showIdle(tabId);
      return;
    }
    // Self-perpetuating: onUpdated does NOT reschedule, the chain re-arms here.
    const fresh = timers.get(tabId);
    if (fresh) fresh.timeoutId = armTimer(tabId, fresh);
  }, delayMsForSeconds(state.seconds));
}

async function startTimer(tabId, seconds, scope) {
  if (!isValidTabId(tabId)) throw new Error("Invalid tab");
  const secs = Math.floor(Number(seconds));
  if (!Number.isFinite(secs) || secs < 1) throw new Error("Invalid interval");
  if (secs > MAX_INTERVAL_SECS) {
    throw new Error(`Interval too long (max ${MAX_INTERVAL_SECS} seconds)`);
  }
  if (!["tab", "page", "domain"].includes(scope)) throw new Error("Invalid scope");

  const tab = await api.tabs.get(tabId);
  if (!tab?.url || !isRefreshableUrl(tab.url)) {
    throw new Error("This page can't be auto-reloaded");
  }

  const existing = timers.get(tabId);
  if (existing) clearTimeout(existing.timeoutId);

  const state = {
    timeoutId: 0,
    seconds: secs,
    scope,
    pageKey: pageKeyForUrl(tab.url),
    host: hostForUrl(tab.url),
  };
  state.timeoutId = armTimer(tabId, state);
  timers.set(tabId, state);
  recentCancels.delete(tabId); // a fresh timer supersedes any old notice
  await showActive(tabId, secs);

  const { timeoutId: _t, ...publicState } = state;
  return publicState;
}

// --- navigation guard: auto-cancel when a locked tab leaves its scope ---

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    // NOTE: tab-specific badge text/icon are reset by the browser on every
    // navigation (MDN: setBadgeText tabId "is reset when the user navigates
    // this tab to a new page"), so any persisted visual state must be
    // re-asserted here — including back/forward navigations, which fire
    // onUpdated but match no scope guard.
    const st = timers.get(tabId);
    if (st) {
      if (st.scope === "tab") {
        await showActive(tabId, st.seconds);
        return;
      }
      const url = tab?.url ?? changeInfo?.url;
      if (!url) return;
      if (st.scope === "page" && pageKeyForUrl(url) !== st.pageKey) {
        await stopTimer(tabId, lockInfo(st));
      } else if (st.scope === "domain" && hostForUrl(url) !== st.host) {
        await stopTimer(tabId, lockInfo(st));
      } else {
        await showActive(tabId, st.seconds);
      }
      return;
    }
    // No live timer: a pending cancel notice survives navigation (it is
    // only consumed by opening the popup), so restore its yellow badge.
    if (recentCancels.has(tabId)) {
      await showCancelled(tabId);
    }
  } catch (e) {
    console.warn(`onUpdated guard failed for tab ${tabId}:`, e);
  }
});

api.tabs.onRemoved.addListener((tabId) => {
  const st = timers.get(tabId);
  if (st) clearTimeout(st.timeoutId);
  timers.delete(tabId);
  recentCancels.delete(tabId);
});

// Tab replacement (prerender / session-restore swap): migrate the timer to
// the new tab id. The old timeout closure still references the removed id,
// so re-arm under the new id instead of reusing the handle.
if (api.tabs.onReplaced?.addListener) {
  api.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    try {
      const st = timers.get(removedTabId);
      if (st) {
        clearTimeout(st.timeoutId);
        timers.delete(removedTabId);
        st.timeoutId = armTimer(addedTabId, st);
        timers.set(addedTabId, st);
        await showActive(addedTabId, st.seconds);
      }
      const notice = recentCancels.get(removedTabId);
      if (notice) {
        recentCancels.delete(removedTabId);
        recentCancels.set(addedTabId, notice);
      }
    } catch (e) {
      console.warn(`onReplaced migration ${removedTabId} -> ${addedTabId} failed:`, e);
    }
  });
}

// --- startup / suspend hygiene --------------------------------------------
// Badges are per-tab UI state that can outlive the in-memory timer map
// across restarts or background reloads. Reset them best-effort so a stale
// interval badge is never shown for a dead timer.
async function resetAllBadges() {
  try {
    const tabs = await api.tabs.query({});
    for (const t of tabs) {
      if (t?.id == null) continue;
      try {
        await showIdle(t.id);
      } catch (e) {
        console.warn(`reset badge for tab ${t.id} failed:`, e);
      }
    }
  } catch (e) {
    console.warn("resetAllBadges failed:", e);
  }
}

if (api.runtime.onStartup?.addListener) {
  api.runtime.onStartup.addListener(() => {
    timers.clear();
    pruneRecentCancels();
    resetAllBadges().catch((e) => console.warn("onStartup reset failed:", e));
  });
}

if (api.runtime.onInstalled?.addListener) {
  api.runtime.onInstalled.addListener(() => {
    resetAllBadges().catch((e) => console.warn("onInstalled reset failed:", e));
  });
}

if (api.runtime.onSuspend?.addListener) {
  api.runtime.onSuspend.addListener(() => {
    for (const [, st] of timers) clearTimeout(st.timeoutId);
  });
}

// Opportunistic expiry so un-consumed cancel notices can't accumulate.
setInterval(() => pruneRecentCancels(), 60 * 1000);

// --- popup messaging ------------------------------------------------------

api.runtime.onMessage.addListener(async (msg) => {
  if (!msg || typeof msg !== "object") return null;

  if (msg.type === "getTimer") {
    if (!isValidTabId(msg.tabId)) return null;
    const st = timers.get(msg.tabId);
    if (!st) return null;
    return { seconds: st.seconds, scope: st.scope, pageKey: st.pageKey, host: st.host };
  }

  if (msg.type === "startTimer") {
    if (!isValidTabId(msg.tabId)) return null;
    return await startTimer(msg.tabId, msg.seconds, msg.scope);
  }

  if (msg.type === "stopTimer") {
    if (!isValidTabId(msg.tabId)) return null;
    await stopTimer(msg.tabId);
    return { stopped: true };
  }

  if (msg.type === "getCancel") {
    if (!isValidTabId(msg.tabId)) return null;
    pruneRecentCancels();
    const info = recentCancels.get(msg.tabId) ?? null;
    if (!info) return null;
    if (Date.now() - info.at > RECENT_CANCEL_TTL_MS) {
      recentCancels.delete(msg.tabId);
      await showIdle(msg.tabId);
      return null;
    }
    // Consume the notice: reset the yellow light, popup holds the text.
    recentCancels.delete(msg.tabId);
    await showIdle(msg.tabId);
    return info;
  }

  return null;
});
