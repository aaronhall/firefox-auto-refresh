const api = globalThis.browser ?? chrome;

const $ = (id) => document.getElementById(id);
const scopeRadios = [...document.querySelectorAll('input[name="scope"]')];
const targetLabel = $("targetLabel");
const intervalInput = $("intervalInput");
const saveBtn = $("saveBtn");
const stopBtn = $("stopBtn");
const statusEl = $("status");
const scopeDescEl = $("scopeDesc");
const dotEl = $("statusDot");
const presetBtns = [...document.querySelectorAll(".presets button")];

let currentTab = null;
let currentPageKey = "";
let currentHost = "";
let activeTimer = null; // { seconds, scope, pageKey, host } | null
let cancelInfo = null; // { scope, seconds, host, pageKey, at } | null (consumed notice)

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

function fmt(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = secs / 60;
    return Number.isInteger(m) ? `${m} min` : `${secs}s`;
  }
  const h = secs / 3600;
  return Number.isInteger(h) ? `${h} hr` : `${Math.round((h + Number.EPSILON) * 100) / 100} hr`;
}

function selectedScope() {
  return document.querySelector('input[name="scope"]:checked')?.value ?? "tab";
}

function setScope(scope) {
  const radio = document.querySelector(`input[name="scope"][value="${scope}"]`);
  if (radio) radio.checked = true;
}

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

function targetForScope(scope) {
  if (scope === "page") return currentPageKey;
  if (scope === "domain") return currentHost;
  return currentTab?.url ?? "";
}

function lockSummary(scope, timer) {
  const ref = timer ?? { pageKey: currentPageKey, host: currentHost };
  if (scope === "page") return `Locked to page — stops if this tab leaves the page (ignores #hash).`;
  if (scope === "domain")
    return `Locked to ${ref.host || "this site"} — stops if this tab leaves the site.`;
  return "Follows this tab even if you navigate elsewhere. Closes with the tab.";
}

function refreshUI() {
  const scope = selectedScope();
  const label = targetForScope(scope);
  targetLabel.textContent = label || "—";
  targetLabel.title = label || "";

  const cur = Number(intervalInput.value);
  presetBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.secs) === cur));

  if (activeTimer) {
    saveBtn.textContent = "Update timer";
    stopBtn.disabled = false;
    const where =
      activeTimer.scope === "page"
        ? "this page"
        : activeTimer.scope === "domain"
          ? `this site (${activeTimer.host})`
          : "this tab";
    setStatus(`This tab refreshes every ${fmt(activeTimer.seconds)} (${where}).`, "ok");
    dotEl.className = "dot on";
  } else if (cancelInfo) {
    saveBtn.textContent = "Start timer";
    stopBtn.disabled = true;
    const where =
      cancelInfo.scope === "page"
        ? "this page"
        : cancelInfo.scope === "domain"
          ? `this site (${cancelInfo.host})`
          : "this tab";
    setStatus(
      `Timer stopped — this tab left ${where} (was every ${fmt(cancelInfo.seconds)}).`,
      "warn"
    );
    dotEl.className = "dot warn";
  } else {
    saveBtn.textContent = "Start timer";
    stopBtn.disabled = true;
    setStatus("Timer is off for this tab.", "");
    dotEl.className = "dot off";
  }

  scopeDescEl.textContent = lockSummary(scope, activeTimer);
}

function disableAll(msg) {
  targetLabel.textContent = "Can't auto-refresh this page";
  targetLabel.title = currentTab?.url ?? "";
  setStatus(msg, "warn");
  scopeDescEl.textContent = "";
  intervalInput.disabled = true;
  saveBtn.disabled = true;
  stopBtn.disabled = true;
  presetBtns.forEach((b) => (b.disabled = true));
  scopeRadios.forEach((r) => (r.disabled = true));
  dotEl.className = "dot off";
}

async function loadState() {
  let tabs;
  try {
    tabs = await api.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    setStatus("Couldn't read the active tab.", "err");
    return;
  }
  currentTab = tabs[0];

  if (!currentTab?.id || !currentTab.url) {
    disableAll("No active tab found.");
    return;
  }

  let url = null;
  try {
    url = new URL(currentTab.url);
  } catch {
    url = null;
  }

  const blocked =
    !url ||
    ["about:", "moz-extension:", "chrome:", "edge:", "view-source:", "data:"].some((p) =>
      currentTab.url.startsWith(p)
    );
  if (blocked) {
    disableAll("This page can't be auto-refreshed.");
    return;
  }

  currentPageKey = pageKeyForUrl(currentTab.url);
  currentHost = url.hostname;

  try {
    activeTimer = await api.runtime.sendMessage({ type: "getTimer", tabId: currentTab.id });
  } catch {
    activeTimer = null;
  }
  try {
    // Consumes the notice (background resets the yellow badge); we keep the text.
    cancelInfo = activeTimer
      ? null
      : await api.runtime.sendMessage({ type: "getCancel", tabId: currentTab.id });
  } catch {
    cancelInfo = null;
  }

  if (activeTimer) {
    cancelInfo = null;
    setScope(activeTimer.scope);
    intervalInput.value = activeTimer.seconds;
  } else if (cancelInfo) {
    // Prefill the previous scope + interval for one-click restart.
    setScope(cancelInfo.scope);
    intervalInput.value = cancelInfo.seconds;
  } else {
    setScope("tab"); // default scope: whole tab
    intervalInput.value = "";
  }

  refreshUI();
}

async function save() {
  const secs = Math.floor(Number(intervalInput.value));
  if (!Number.isFinite(secs) || secs < 1) {
    setStatus("Enter an interval of at least 1 second.", "err");
    intervalInput.focus();
    return;
  }
  const scope = selectedScope();
  try {
    activeTimer = await api.runtime.sendMessage({
      type: "startTimer",
      tabId: currentTab.id,
      seconds: secs,
      scope,
    });
    cancelInfo = null;
  } catch (e) {
    setStatus(e?.message || "Couldn't start the timer.", "err");
    return;
  }
  refreshUI();
  setStatus(
    scope === "tab"
      ? `This tab will refresh every ${fmt(secs)}, anywhere you navigate.`
      : scope === "page"
        ? `This tab will refresh every ${fmt(secs)} until it leaves this page.`
        : `This tab will refresh every ${fmt(secs)} until it leaves ${currentHost}.`,
    "ok"
  );
}

async function stop() {
  try {
    await api.runtime.sendMessage({ type: "stopTimer", tabId: currentTab.id });
  } catch {
    // background may have already dropped it — treat as stopped
  }
  activeTimer = null;
  cancelInfo = null;
  refreshUI();
  setStatus("Timer stopped for this tab.", "warn");
}

// --- wiring ---------------------------------------------------------------

scopeRadios.forEach((r) => r.addEventListener("change", refreshUI));

presetBtns.forEach((b) =>
  b.addEventListener("click", () => {
    intervalInput.value = b.dataset.secs;
    refreshUI();
    intervalInput.focus();
  })
);

intervalInput.addEventListener("input", () => {
  const cur = Number(intervalInput.value);
  presetBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.secs) === cur));
});

intervalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});

saveBtn.addEventListener("click", save);
stopBtn.addEventListener("click", stop);

loadState();
