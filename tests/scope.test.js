"use strict";
const { describe, it } = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Extension pages load these as classic scripts sharing ONE global lexical
// scope (popup.html script tags, manifest background.scripts). A top-level
// redeclaration across files is a whole-page SyntaxError that per-file
// `node --check` cannot catch — so check the concatenation, as loaded.
const root = path.join(__dirname, "..");

function assertSharedScopeParses(first, second) {
  const combined =
    fs.readFileSync(path.join(root, first), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, second), "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-scope-"));
  const file = path.join(dir, "combined.js");
  fs.writeFileSync(file, combined);
  execFileSync(process.execPath, ["--check", file]);
}

describe("shared classic-script scope (as loaded by the extension)", () => {
  it("utils.js + popup.js parse together", () => {
    assertSharedScopeParses("utils.js", "popup.js");
  });
  it("utils.js + background.js parse together", () => {
    assertSharedScopeParses("utils.js", "background.js");
  });
});
