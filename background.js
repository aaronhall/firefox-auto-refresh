// Per-tab auto-refresh scheduler.
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
const api = globalThis.browser ?? chrome;

// tabId -> { timeoutId, seconds, scope, pageKey, host }
const timers = new Map();

// tabId -> { scope, seconds, host, pageKey, at } (unseen auto-cancel notices)
const recentCancels = new Map();

const ICON_IDLE = { 48: "icons/icon-48-gray.svg", 96: "icons/icon-96-gray.svg" };
const ICON_ACTIVE = { 48: "icons/icon-48.svg", 96: "icons/icon-96.svg" };

const IGNORED_SCHEMES = [
  "about:",
  "moz-extension:",
  "chrome:",
  "edge:",
  "view-source:",
  "data:",
  "file:",
];

function isRefreshableUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return !IGNORED_SCHEMES.some((s) => u.protocol === s || url.startsWith(s));
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

function badgeText(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

async function setIcon(tabId, active) {
  try {
    await api.action.setIcon({ tabId, path: active ? ICON_ACTIVE : ICON_IDLE });
  } catch {
    // tab may be gone — ignore
  }
}

async function showActive(tabId, seconds) {
  await setIcon(tabId, true);
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: "#0074e8" });
    await api.action.setBadgeText({ tabId, text: badgeText(seconds) });
  } catch {
    // tab may be gone — ignore
  }
}

async function showIdle(tabId) {
  await setIcon(tabId, false);
  try {
    await api.action.setBadgeText({ tabId, text: "" });
  } catch {
    // tab may be gone — ignore
  }
}

async function showCancelled(tabId) {
  await setIcon(tabId, false);
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: "#e07f00" });
    await api.action.setBadgeText({ tabId, text: "!" });
  } catch {
    // tab may be gone — ignore
  }
}

/**
 * @param {number} tabId
 * @param {{ scope, seconds, host, pageKey } | null} autoCancel
 *   Pass the timer's lock info when the scope guard fires so the popup
 *   can explain why; null for manual stops / supersedes.
 */
async function stopTimer(tabId, autoCancel = null) {
  const st = timers.get(tabId);
  if (st) clearTimeout(st.timeoutId);
  timers.delete(tabId);
  if (autoCancel) {
    recentCancels.set(tabId, { ...autoCancel, at: Date.now() });
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
    } catch {
      // Tab closed or reload rejected — drop the timer.
      timers.delete(tabId);
      recentCancels.delete(tabId);
      return;
    }
    // Self-perpetuating: onUpdated does NOT reschedule, the chain re-arms here.
    const fresh = timers.get(tabId);
    if (fresh) fresh.timeoutId = armTimer(tabId, fresh);
  }, Math.max(1, Math.floor(state.seconds)) * 1000);
}

async function startTimer(tabId, seconds, scope) {
  const secs = Math.floor(Number(seconds));
  if (!Number.isFinite(secs) || secs < 1) throw new Error("Invalid interval");
  if (!["tab", "page", "domain"].includes(scope)) throw new Error("Invalid scope");

  const tab = await api.tabs.get(tabId);
  if (!tab?.url || !isRefreshableUrl(tab.url)) {
    throw new Error("This page can't be auto-refreshed");
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
  const st = timers.get(tabId);
  if (!st || st.scope === "tab") return;
  const url = tab?.url ?? changeInfo?.url;
  if (!url) return;
  if (st.scope === "page" && pageKeyForUrl(url) !== st.pageKey) {
    await stopTimer(tabId, lockInfo(st));
  } else if (st.scope === "domain" && hostForUrl(url) !== st.host) {
    await stopTimer(tabId, lockInfo(st));
  }
});

api.tabs.onRemoved.addListener((tabId) => {
  const st = timers.get(tabId);
  if (st) clearTimeout(st.timeoutId);
  timers.delete(tabId);
  recentCancels.delete(tabId);
});

// --- popup messaging ------------------------------------------------------

api.runtime.onMessage.addListener(async (msg) => {
  if (!msg || typeof msg !== "object") return null;

  if (msg.type === "getTimer") {
    const st = timers.get(msg.tabId);
    if (!st) return null;
    return { seconds: st.seconds, scope: st.scope, pageKey: st.pageKey, host: st.host };
  }

  if (msg.type === "startTimer") {
    return await startTimer(msg.tabId, msg.seconds, msg.scope);
  }

  if (msg.type === "stopTimer") {
    await stopTimer(msg.tabId);
    return { stopped: true };
  }

  if (msg.type === "getCancel") {
    const info = recentCancels.get(msg.tabId) ?? null;
    if (info) {
      // Consume the notice: reset the yellow light, popup holds the text.
      recentCancels.delete(msg.tabId);
      await showIdle(msg.tabId);
    }
    return info;
  }

  return null;
});
