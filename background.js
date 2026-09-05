// Background scheduler — uses tabs.reload() + setTimeout so
// second-precision intervals work (alarms clamp to >= 30s).
const api = globalThis.browser ?? chrome;

const timers = new Map(); // tabId -> timeout id

const IGNORED_SCHEMES = ["about:", "moz-extension:", "chrome:", "edge:", "view-source:", "data:", "file:"];

function isRefreshableUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return !IGNORED_SCHEMES.some((s) => u.protocol === s || url.startsWith(s));
  } catch {
    return false;
  }
}

function pageKeyForUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url.split("#")[0];
  }
}

function hostForUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function getRules() {
  const { pageRules = {}, domainRules = {} } = await api.storage.local.get([
    "pageRules",
    "domainRules",
  ]);
  return { pageRules, domainRules };
}

/**
 * Page rule wins over domain rule.
 * Returns { seconds, scope: 'page' | 'domain', key } or null.
 */
async function getMatchForUrl(url) {
  if (!isRefreshableUrl(url)) return null;
  const { pageRules, domainRules } = await getRules();
  const pKey = pageKeyForUrl(url);
  const host = hostForUrl(url);
  if (pKey && pageRules[pKey] > 0) {
    return { seconds: pageRules[pKey], scope: "page", key: pKey };
  }
  if (host && domainRules[host] > 0) {
    return { seconds: domainRules[host], scope: "domain", key: host };
  }
  return null;
}

function clearTimer(tabId) {
  const t = timers.get(tabId);
  if (t) {
    clearTimeout(t);
    timers.delete(tabId);
  }
}

async function updateBadge(tabId, match) {
  try {
    if (!match) {
      await api.action.setBadgeText({ tabId, text: "" });
      return;
    }
    const s = match.seconds;
    const text = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
    await api.action.setBadgeBackgroundColor({ tabId, color: "#0074e8" });
    await api.action.setBadgeText({ tabId, text });
  } catch {
    // tab may be gone — ignore
  }
}

async function scheduleForTab(tab) {
  if (!tab || tab.id == null) return;
  clearTimer(tab.id);

  // Re-read fresh URL in case `tab` object is stale.
  let url = tab.url;
  try {
    if (!url) {
      const fresh = await api.tabs.get(tab.id);
      url = fresh.url;
    }
  } catch {
    return;
  }

  const match = await getMatchForUrl(url);
  await updateBadge(tab.id, match);
  if (!match || !(match.seconds > 0)) return;

  const delayMs = Math.max(1, Math.floor(match.seconds)) * 1000;
  const timeoutId = setTimeout(async () => {
    timers.delete(tab.id);
    try {
      await api.tabs.reload(tab.id);
      // onUpdated(complete) will reschedule; add a fallback reschedule
      // in case the event is missed (e.g. reload fails silently).
      try {
        const fresh = await api.tabs.get(tab.id);
        scheduleForTab(fresh);
      } catch {
        /* tab closed */
      }
    } catch {
      /* tab closed or no permission — ignore */
    }
  }, delayMs);

  timers.set(tab.id, timeoutId);
}

async function scheduleAll() {
  try {
    const tabs = await api.tabs.query({});
    await Promise.all(tabs.map(scheduleForTab));
  } catch (e) {
    console.warn("Auto Refresh: scheduleAll failed", e);
  }
}

// --- events ---------------------------------------------------------------

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Reschedule when navigation commits/completes or URL changes.
  if (changeInfo.status === "complete" || changeInfo.url) {
    scheduleForTab(tab);
  }
});

api.tabs.onRemoved.addListener((tabId) => clearTimer(tabId));

api.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await api.tabs.get(tabId);
    scheduleForTab(tab);
  } catch {
    /* ignore */
  }
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.pageRules || changes.domainRules)) {
    scheduleAll();
  }
});

api.runtime.onInstalled.addListener(scheduleAll);
if (api.runtime.onStartup) api.runtime.onStartup.addListener(scheduleAll);

// Initial sweep (covers browser restart with persistent background page).
scheduleAll();
