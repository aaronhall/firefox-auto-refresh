const api = globalThis.browser ?? chrome;

const $ = (id) => document.getElementById(id);
const scopeRadios = [...document.querySelectorAll('input[name="scope"]')];
const targetLabel = $("targetLabel");
const intervalInput = $("intervalInput");
const saveBtn = $("saveBtn");
const stopBtn = $("stopBtn");
const statusEl = $("status");
const summaryEl = $("summary");
const dotEl = $("statusDot");
const presetBtns = [...document.querySelectorAll(".presets button")];

let currentTab = null;
let pageKey = "";
let hostname = "";
let pageRule = null;   // seconds | null
let domainRule = null; // seconds | null

function pageKeyForUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return (url || "").split("#")[0];
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
  return document.querySelector('input[name="scope"]:checked')?.value ?? "page";
}

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

async function loadState() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    setStatus("No active tab found.", "warn");
    saveBtn.disabled = true;
    stopBtn.disabled = true;
    return false;
  }

  let url;
  try {
    url = new URL(currentTab.url);
  } catch {
    url = null;
  }

  const blocked = !url || ["about:", "moz-extension:", "chrome:", "edge:", "view-source:", "data:"].some(
    (p) => currentTab.url.startsWith(p)
  );

  if (blocked) {
    targetLabel.textContent = "Can't auto-refresh this page";
    targetLabel.title = currentTab.url;
    setStatus("This page can't be auto-refreshed.", "warn");
    summaryEl.textContent = "";
    intervalInput.disabled = true;
    saveBtn.disabled = true;
    stopBtn.disabled = true;
    presetBtns.forEach((b) => (b.disabled = true));
    dotEl.className = "dot off";
    return false;
  }

  pageKey = pageKeyForUrl(currentTab.url);
  hostname = url.hostname;

  const { pageRules = {}, domainRules = {} } = await api.storage.local.get([
    "pageRules",
    "domainRules",
  ]);
  pageRule = pageRules[pageKey] ?? null;
  domainRule = domainRules[hostname] ?? null;

  refreshUI();
  return true;
}

function refreshUI() {
  const scope = selectedScope();

  if (scope === "page") {
    targetLabel.textContent = pageKey;
    targetLabel.title = pageKey;
    intervalInput.value = pageRule ?? "";
    saveBtn.textContent = pageRule ? "Update page timer" : "Start page timer";
    stopBtn.disabled = !pageRule;
    if (pageRule) setStatus(`This page refreshes every ${fmt(pageRule)}.`, "ok");
    else setStatus("Page timer is off.", "");
  } else {
    targetLabel.textContent = hostname;
    targetLabel.title = hostname;
    intervalInput.value = domainRule ?? "";
    saveBtn.textContent = domainRule ? "Update domain timer" : "Start domain timer";
    stopBtn.disabled = !domainRule;
    if (domainRule) setStatus(`All ${hostname} pages refresh every ${fmt(domainRule)}.`, "ok");
    else setStatus("Domain timer is off.", "");
  }

  // Preset highlight
  const cur = Number(intervalInput.value);
  presetBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.secs) === cur));

  // Summary of both timers + precedence note
  const parts = [];
  if (pageRule) parts.push(`Page: every ${fmt(pageRule)}`);
  if (domainRule) parts.push(`Domain (${hostname}): every ${fmt(domainRule)}`);
  summaryEl.textContent = parts.length
    ? parts.join("  •  ") + (pageRule && domainRule ? "  (page wins on this page)" : "")
    : "No timers set for this page or domain.";

  const effective = pageRule ?? domainRule;
  dotEl.className = `dot ${effective ? "on" : "off"}`;
}

async function save() {
  const secs = Math.floor(Number(intervalInput.value));
  if (!Number.isFinite(secs) || secs < 1) {
    setStatus("Enter an interval of at least 1 second.", "err");
    intervalInput.focus();
    return;
  }
  const scope = selectedScope();
  const storeKey = scope === "page" ? "pageRules" : "domainRules";
  const ruleKey = scope === "page" ? pageKey : hostname;

  const data = await api.storage.local.get([storeKey]);
  const rules = data[storeKey] ?? {};
  rules[ruleKey] = secs;
  await api.storage.local.set({ [storeKey]: rules });

  if (scope === "page") pageRule = secs;
  else domainRule = secs;
  refreshUI();
  setStatus(
    scope === "page"
      ? `This page will refresh every ${fmt(secs)}.`
      : `All ${hostname} pages will refresh every ${fmt(secs)}.`,
    "ok"
  );
}

async function stop() {
  const scope = selectedScope();
  const storeKey = scope === "page" ? "pageRules" : "domainRules";
  const ruleKey = scope === "page" ? pageKey : hostname;

  const data = await api.storage.local.get([storeKey]);
  const rules = data[storeKey] ?? {};
  delete rules[ruleKey];
  await api.storage.local.set({ [storeKey]: rules });

  if (scope === "page") pageRule = null;
  else domainRule = null;
  refreshUI();
  setStatus(scope === "page" ? "Page timer stopped." : "Domain timer stopped.", "warn");
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
