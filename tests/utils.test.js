"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_INTERVAL_SECS,
  isRefreshableUrl,
  pageKeyForUrl,
  hostForUrl,
  badgeText,
  fmtInterval,
  clampInterval,
} = require("../utils.js");

describe("pageKeyForUrl: hash is ignored", () => {
  it("strips #hash so SPA/anchor nav does not count as leaving", () => {
    assert.equal(
      pageKeyForUrl("https://example.com/a?x=1#section"),
      "https://example.com/a?x=1"
    );
    assert.equal(
      pageKeyForUrl("https://example.com/a#one"),
      pageKeyForUrl("https://example.com/a#two")
    );
  });

  it("query strings count as part of the page", () => {
    assert.notEqual(
      pageKeyForUrl("https://example.com/a?x=1"),
      pageKeyForUrl("https://example.com/a?x=2")
    );
  });

  it("falls back to pre-# string for invalid URLs", () => {
    assert.equal(pageKeyForUrl("not a url#frag"), "not a url");
  });
});

describe("hostForUrl", () => {
  it("extracts hostname", () => {
    assert.equal(hostForUrl("https://sub.example.com:443/p?q=1#f"), "sub.example.com");
    assert.equal(hostForUrl("http://localhost:3000/"), "localhost");
  });

  it("returns empty string for invalid URLs", () => {
    assert.equal(hostForUrl("not a url"), "");
    assert.equal(hostForUrl(""), "");
  });
});

describe("badgeText boundaries", () => {
  it("59s stays seconds, 60s becomes minutes", () => {
    assert.equal(badgeText(59), "59s");
    assert.equal(badgeText(60), "1m");
  });

  it("rounds minutes and hours", () => {
    assert.equal(badgeText(90), "2m");
    assert.equal(badgeText(3599), "60m");
    assert.equal(badgeText(3600), "1h");
    assert.equal(badgeText(7200), "2h");
  });
});

describe("fmtInterval", () => {
  it("formats seconds, whole minutes, and hours", () => {
    assert.equal(fmtInterval(45), "45s");
    assert.equal(fmtInterval(60), "1 min");
    assert.equal(fmtInterval(300), "5 min");
    assert.equal(fmtInterval(3600), "1 hr");
  });

  it("keeps non-integer minutes in seconds", () => {
    assert.equal(fmtInterval(90), "90s");
  });
});

describe("isRefreshableUrl allowlist", () => {
  it("allows http/https only", () => {
    assert.equal(isRefreshableUrl("https://example.com/"), true);
    assert.equal(isRefreshableUrl("http://example.com/"), true);
  });

  it("rejects privileged and opaque schemes (fails closed)", () => {
    for (const u of [
      "about:config",
      "moz-extension://abc/page.html",
      "chrome://newtab/",
      "view-source:https://example.com/",
      "data:text/plain,hi",
      "file:///etc/hosts",
      "blob:https://example.com/uuid",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      assert.equal(isRefreshableUrl(u), false, String(u));
    }
  });
});

describe("clampInterval", () => {
  it(`clamps into [1, ${MAX_INTERVAL_SECS}]`, () => {
    assert.equal(clampInterval(60), 60);
    assert.equal(clampInterval(0), 1);
    assert.equal(clampInterval(-5), 1);
    assert.equal(clampInterval(1e12), MAX_INTERVAL_SECS);
    assert.equal(MAX_INTERVAL_SECS, 86400);
  });

  it("throws on non-numeric input", () => {
    assert.throws(() => clampInterval("abc"), /Invalid interval/);
    assert.throws(() => clampInterval(undefined), /Invalid interval/);
  });
});
