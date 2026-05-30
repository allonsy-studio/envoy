// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import test from "ava";

import { spawnSync } from "node:child_process";

import {
  auditEnvFile,
  buildEnvContent,
  checkEnv,
  copyEnv,
  filesToScan,
  findExampleFiles,
  isPlaceholderValue,
  isSecretShapedKey,
  parseEnvFile,
  parseLine,
  processExampleFile,
  scanContent,
} from "./index.js";
import {
  checkEnvToolHandler,
  copyEnvToolHandler,
  formatCheckFindings,
  formatResults,
} from "./mcp.js";

// ─── helpers ────────────────────────────────────────────────────────────────

/** @returns {string} */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "envoy-"));
}

/** @param {string} dir */
function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Initialise a bare git repo in a temp directory, optionally writing a
 * .gitignore and making an initial commit so the repo has a HEAD.
 *
 * @param {{ gitignore?: string }} [opts]
 * @returns {string} path to the new repo
 */
function tmpGitDir({ gitignore = "" } = {}) {
  const dir = tmpDir();
  const git = (/** @type {string[]} */ args) =>
    spawnSync("git", args, { cwd: dir });
  git(["init"]);
  git(["config", "user.email", "test@envoy.dev"]);
  git(["config", "user.name", "Envoy Test"]);
  if (gitignore) {
    fs.writeFileSync(path.join(dir, ".gitignore"), gitignore);
    git(["add", ".gitignore"]);
    git(["commit", "-m", "init"]);
  }
  return dir;
}

// ─── parseLine ───────────────────────────────────────────────────────────────

test("parseLine: returns null for an empty string", (t) =>
  t.is(parseLine(""), null));

test("parseLine: returns null for whitespace-only input", (t) =>
  t.is(parseLine("   "), null));

test("parseLine: returns null for comment lines", (t) => {
  t.is(parseLine("# a comment"), null);
  t.is(parseLine("  # indented"), null);
});

test("parseLine: returns null for lines without =", (t) =>
  t.is(parseLine("JUST_A_KEY"), null));

test("parseLine: returns null when key is empty", (t) =>
  t.is(parseLine("=value"), null));

test("parseLine: parses a standard KEY=VALUE pair", (t) =>
  t.deepEqual(parseLine("KEY=value"), { key: "KEY", value: "value" }));

test("parseLine: handles an empty value (KEY=)", (t) =>
  t.deepEqual(parseLine("KEY="), { key: "KEY", value: "" }));

test("parseLine: handles a value that contains =", (t) =>
  t.deepEqual(parseLine("URL=http://x.com?a=1&b=2"), {
    key: "URL",
    value: "http://x.com?a=1&b=2",
  }));

// ─── parseEnvFile ────────────────────────────────────────────────────────────

test("parseEnvFile: returns an empty Map for a non-existent file", (t) =>
  t.is(parseEnvFile("/nonexistent/.env").size, 0));

test("parseEnvFile: parses key/value pairs and skips comments", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env"), "# comment\nFOO=bar\nBAZ=qux\n");
    const map = parseEnvFile(path.join(dir, ".env"));
    t.is(map.get("FOO"), "bar");
    t.is(map.get("BAZ"), "qux");
    t.is(map.size, 2);
  } finally {
    cleanup(dir);
  }
});

// ─── findExampleFiles ─────────────────────────────────────────────────────────

test("findExampleFiles: locates a .env.example in the root dir", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "");
    const files = findExampleFiles(dir);
    t.is(files.length, 1);
    t.true(files[0].endsWith(".env.example"));
  } finally {
    cleanup(dir);
  }
});

test("findExampleFiles: excludes node_modules", (t) => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "node_modules", "pkg", ".env.example"),
      "",
    );
    fs.writeFileSync(path.join(dir, ".env.example"), "");
    const files = findExampleFiles(dir);
    t.is(files.length, 1);
    t.false(files[0].includes("node_modules"));
  } finally {
    cleanup(dir);
  }
});

test("findExampleFiles: finds nested .env.example files", (t) => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, "packages", "a"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".env.example"), "");
    fs.writeFileSync(path.join(dir, "packages", "a", ".env.example"), "");
    t.is(findExampleFiles(dir).length, 2);
  } finally {
    cleanup(dir);
  }
});

// ─── buildEnvContent ─────────────────────────────────────────────────────────

test("buildEnvContent: preserves comments and blank lines", (t) => {
  const dir = tmpDir();
  try {
    const example = "# App config\nFOO=bar\n\n# DB\nDB=postgres\n";
    fs.writeFileSync(path.join(dir, ".env.example"), example);
    const content = buildEnvContent(
      path.join(dir, ".env.example"),
      new Map(),
    );
    t.is(content, example);
  } finally {
    cleanup(dir);
  }
});

test("buildEnvContent: replaces values found in rootEnv", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(
      path.join(dir, ".env.example"),
      "FOO=default\nBAR=stays\n",
    );
    const content = buildEnvContent(
      path.join(dir, ".env.example"),
      new Map([["FOO", "from-root"]]),
    );
    t.true(content.includes("FOO=from-root"));
    t.true(content.includes("BAR=stays"));
  } finally {
    cleanup(dir);
  }
});

test("buildEnvContent: leaves keys absent from rootEnv unchanged", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "MISSING=fallback\n");
    const content = buildEnvContent(
      path.join(dir, ".env.example"),
      new Map(),
    );
    t.is(content, "MISSING=fallback\n");
  } finally {
    cleanup(dir);
  }
});

// ─── processExampleFile ───────────────────────────────────────────────────────

test("processExampleFile: returns skipped when .env already exists", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    fs.writeFileSync(path.join(dir, ".env"), "FOO=existing\n");
    const result = processExampleFile(
      path.join(dir, ".env.example"),
      new Map(),
    );
    t.is(result.status, "skipped");
  } finally {
    cleanup(dir);
  }
});

test("processExampleFile: returns would-create and content for dry-run", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const result = processExampleFile(
      path.join(dir, ".env.example"),
      new Map(),
      { dryRun: true },
    );
    t.is(result.status, "would-create");
    t.is(result.content, "FOO=bar\n");
    t.false(fs.existsSync(path.join(dir, ".env")));
  } finally {
    cleanup(dir);
  }
});

// ─── copyEnv ─────────────────────────────────────────────────────────────────

test("copyEnv: creates a .env file from .env.example", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const [result] = copyEnv(dir);
    t.is(result.status, "created");
    t.true(fs.existsSync(path.join(dir, ".env")));
    t.is(fs.readFileSync(path.join(dir, ".env"), "utf8"), "FOO=bar\n");
  } finally {
    cleanup(dir);
  }
});

test("copyEnv: skips when .env already exists", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    fs.writeFileSync(path.join(dir, ".env"), "FOO=existing\n");
    const [result] = copyEnv(dir);
    t.is(result.status, "skipped");
    t.is(
      fs.readFileSync(path.join(dir, ".env"), "utf8"),
      "FOO=existing\n",
    );
  } finally {
    cleanup(dir);
  }
});

test("copyEnv: --force overwrites an existing .env", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=new\n");
    fs.writeFileSync(path.join(dir, ".env"), "FOO=old\n");
    const [result] = copyEnv(dir, { force: true });
    t.is(result.status, "created");
    t.is(fs.readFileSync(path.join(dir, ".env"), "utf8"), "FOO=new\n");
  } finally {
    cleanup(dir);
  }
});

test("copyEnv: --dry-run does not write any files", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const [result] = copyEnv(dir, { dryRun: true });
    t.is(result.status, "would-create");
    t.is(result.content, "FOO=bar\n");
    t.false(fs.existsSync(path.join(dir, ".env")));
  } finally {
    cleanup(dir);
  }
});

test("copyEnv: substitutes values from a custom rootEnvPath", (t) => {
  const dir = tmpDir();
  try {
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, "FOO=from-root\n");
    fs.writeFileSync(
      path.join(dir, ".env.example"),
      "FOO=default\nBAR=stays\n",
    );
    copyEnv(dir, { rootEnvPath: rootEnv });
    const content = fs.readFileSync(path.join(dir, ".env"), "utf8");
    t.true(content.includes("FOO=from-root"));
    t.true(content.includes("BAR=stays"));
  } finally {
    cleanup(dir);
  }
});

test("copyEnv: returns an empty array when no .env.example files exist", (t) => {
  const dir = tmpDir();
  try {
    t.deepEqual(copyEnv(dir), []);
  } finally {
    cleanup(dir);
  }
});

test("copyEnv: handles multiple .env.example files in nested dirs", (t) => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, "packages", "a"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".env.example"), "ROOT=1\n");
    fs.writeFileSync(
      path.join(dir, "packages", "a", ".env.example"),
      "PKG=1\n",
    );
    const results = copyEnv(dir);
    t.is(results.length, 2);
    t.true(results.every((r) => r.status === "created"));
  } finally {
    cleanup(dir);
  }
});

// ─── formatResults (MCP) ─────────────────────────────────────────────────────

test("formatResults: returns a message when no results", (t) =>
  t.is(formatResults([]), "No .env.example files found."));

test("formatResults: describes a created result", (t) => {
  const text = formatResults([
    { examplePath: "/p/.env.example", envPath: "/p/.env", status: "created" },
  ]);
  t.true(text.includes("Created /p/.env"));
});

test("formatResults: describes a skipped result", (t) => {
  const text = formatResults([
    { examplePath: "/p/.env.example", envPath: "/p/.env", status: "skipped" },
  ]);
  t.true(text.includes("Skipped /p/.env"));
  t.true(text.includes("already exists"));
});

test("formatResults: describes a would-create result with content", (t) => {
  const text = formatResults([
    {
      examplePath: "/p/.env.example",
      envPath: "/p/.env",
      status: "would-create",
      content: "FOO=bar\n",
    },
  ]);
  t.true(text.includes("Would create /p/.env"));
  t.true(text.includes("FOO=bar"));
});

test("formatResults: joins multiple results with newlines", (t) => {
  const text = formatResults([
    { examplePath: "/a/.env.example", envPath: "/a/.env", status: "created" },
    { examplePath: "/b/.env.example", envPath: "/b/.env", status: "skipped" },
  ]);
  t.true(text.includes("Created /a/.env"));
  t.true(text.includes("Skipped /b/.env"));
});

// ─── copyEnvToolHandler (MCP) ─────────────────────────────────────────────────

test("copyEnvToolHandler: returns MCP content structure", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const response = copyEnvToolHandler({ dir });
    t.true(Array.isArray(response.content));
    t.is(response.content[0].type, "text");
    t.true(typeof response.content[0].text === "string");
  } finally {
    cleanup(dir);
  }
});

test("copyEnvToolHandler: created result appears in response text", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const { content } = copyEnvToolHandler({ dir });
    t.true(content[0].text.includes("Created"));
  } finally {
    cleanup(dir);
  }
});

test("copyEnvToolHandler: dry_run does not write files", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const { content } = copyEnvToolHandler({ dir, dry_run: true });
    t.false(fs.existsSync(path.join(dir, ".env")));
    t.true(content[0].text.includes("Would create"));
  } finally {
    cleanup(dir);
  }
});

test("copyEnvToolHandler: substitutes values from root_env_path", (t) => {
  const dir = tmpDir();
  try {
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, "FOO=from-root\n");
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=default\n");
    const { content } = copyEnvToolHandler({ dir, root_env_path: rootEnv });
    t.true(content[0].text.includes("Created"));
    t.is(fs.readFileSync(path.join(dir, ".env"), "utf8"), "FOO=from-root\n");
  } finally {
    cleanup(dir);
  }
});

test("copyEnvToolHandler: returns no-files message when dir is empty", (t) => {
  const dir = tmpDir();
  try {
    const { content } = copyEnvToolHandler({ dir });
    t.is(content[0].text, "No .env.example files found.");
  } finally {
    cleanup(dir);
  }
});

// ─── auditEnvFile ─────────────────────────────────────────────────────────────

test("auditEnvFile: returns isGitRepo false outside a git repo", (t) => {
  const dir = tmpDir();
  try {
    const result = auditEnvFile(path.join(dir, ".env"));
    t.false(result.isGitRepo);
    t.false(result.isGitignored);
    t.false(result.isTracked);
  } finally {
    cleanup(dir);
  }
});

test("auditEnvFile: isGitignored true when .env is in .gitignore", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const result = auditEnvFile(path.join(dir, ".env"));
    t.true(result.isGitRepo);
    t.true(result.isGitignored);
    t.false(result.isTracked);
  } finally {
    cleanup(dir);
  }
});

test("auditEnvFile: isGitignored false when .env is absent from .gitignore", (t) => {
  const dir = tmpGitDir({ gitignore: "*.log\n" });
  try {
    const result = auditEnvFile(path.join(dir, ".env"));
    t.true(result.isGitRepo);
    t.false(result.isGitignored);
    t.false(result.isTracked);
  } finally {
    cleanup(dir);
  }
});

test("auditEnvFile: isTracked true when .env is committed to the repo", (t) => {
  const dir = tmpGitDir({ gitignore: "*.log\n" });
  try {
    const git = (/** @type {string[]} */ args) =>
      spawnSync("git", args, { cwd: dir });
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=oops\n");
    git(["add", ".env"]);
    git(["commit", "-m", "accidentally commit .env"]);
    const result = auditEnvFile(path.join(dir, ".env"));
    t.true(result.isGitRepo);
    t.true(result.isTracked);
  } finally {
    cleanup(dir);
  }
});

// ─── processExampleFile audit integration ────────────────────────────────────

test("processExampleFile: blocks and does not write when .env is tracked", (t) => {
  const dir = tmpGitDir({ gitignore: "*.log\n" });
  try {
    const git = (/** @type {string[]} */ args) =>
      spawnSync("git", args, { cwd: dir });
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=tracked\n");
    git(["add", ".env"]);
    git(["commit", "-m", "accidentally commit .env"]);
    fs.writeFileSync(path.join(dir, ".env.example"), "SECRET=example\n");
    // Remove the existing .env so processExampleFile doesn't skip it
    fs.rmSync(path.join(dir, ".env"));
    const result = processExampleFile(
      path.join(dir, ".env.example"),
      new Map(),
    );
    t.is(result.status, "blocked");
    t.true(result.audit?.isTracked);
    t.false(fs.existsSync(path.join(dir, ".env")));
  } finally {
    cleanup(dir);
  }
});

test("processExampleFile: includes audit result with gitignore warning", (t) => {
  const dir = tmpGitDir({ gitignore: "*.log\n" });
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const result = processExampleFile(
      path.join(dir, ".env.example"),
      new Map(),
    );
    t.is(result.status, "created");
    t.true(result.audit?.isGitRepo);
    t.false(result.audit?.isGitignored);
  } finally {
    cleanup(dir);
  }
});

test("processExampleFile: skipAudit omits audit result entirely", (t) => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    const result = processExampleFile(
      path.join(dir, ".env.example"),
      new Map(),
      { skipAudit: true },
    );
    t.is(result.status, "created");
    t.is(result.audit, undefined);
  } finally {
    cleanup(dir);
  }
});

// ─── formatResults audit warnings ────────────────────────────────────────────

test("formatResults: describes a blocked result", (t) => {
  const text = formatResults([
    {
      examplePath: "/p/.env.example",
      envPath: "/p/.env",
      status: "blocked",
      audit: { isGitRepo: true, isGitignored: false, isTracked: true },
    },
  ]);
  t.true(text.includes("Blocked /p/.env"));
  t.true(text.includes("git rm --cached"));
});

test("formatResults: appends gitignore warning when not gitignored", (t) => {
  const text = formatResults([
    {
      examplePath: "/p/.env.example",
      envPath: "/p/.env",
      status: "created",
      audit: { isGitRepo: true, isGitignored: false, isTracked: false },
    },
  ]);
  t.true(text.includes("Created /p/.env"));
  t.true(text.includes("not covered by .gitignore"));
});

test("formatResults: no gitignore warning when properly gitignored", (t) => {
  const text = formatResults([
    {
      examplePath: "/p/.env.example",
      envPath: "/p/.env",
      status: "created",
      audit: { isGitRepo: true, isGitignored: true, isTracked: false },
    },
  ]);
  t.false(text.includes(".gitignore"));
});

// ─── isPlaceholderValue ───────────────────────────────────────────────────────

test("isPlaceholderValue: treats short values as placeholders", (t) => {
  t.true(isPlaceholderValue(""));
  t.true(isPlaceholderValue("abc"));
  t.true(isPlaceholderValue("1234567")); // 7 chars, below threshold
});

test("isPlaceholderValue: flags common placeholder shapes", (t) => {
  t.true(isPlaceholderValue("xxxxxxxx"));
  t.true(isPlaceholderValue("<your-api-key>"));
  t.true(isPlaceholderValue("your_secret_value"));
  t.true(isPlaceholderValue("changeme-please"));
  t.true(isPlaceholderValue("sk_test_abc123def456"));
  t.true(isPlaceholderValue("some_example_token"));
  t.true(isPlaceholderValue("value_here"));
});

test("isPlaceholderValue: real-looking secrets are not placeholders", (t) => {
  t.false(isPlaceholderValue("sk_live_4eC39HqLyjWDarjtT1zdp7dc"));
  t.false(isPlaceholderValue("postgres://user:p@ssw0rd@host:5432/db"));
  t.false(isPlaceholderValue("AKIAIOSFODNN7EXAMPLEKEY"));
});

test("isPlaceholderValue: strips surrounding quotes before judging", (t) => {
  t.true(isPlaceholderValue('"short"'));
  t.false(isPlaceholderValue('"sk_live_4eC39HqLyjWDarjtT1zdp7dc"'));
});

// ─── isSecretShapedKey ────────────────────────────────────────────────────────

test("isSecretShapedKey: matches secret-shaped key names", (t) => {
  t.true(isSecretShapedKey("STRIPE_SECRET_KEY"));
  t.true(isSecretShapedKey("API_KEY"));
  t.true(isSecretShapedKey("GITHUB_TOKEN"));
  t.true(isSecretShapedKey("DB_PASSWORD"));
  t.true(isSecretShapedKey("AWS_SECRET"));
});

test("isSecretShapedKey: ignores non-secret key names", (t) => {
  t.false(isSecretShapedKey("DATABASE_URL"));
  t.false(isSecretShapedKey("PORT"));
  t.false(isSecretShapedKey("NODE_ENV"));
  t.false(isSecretShapedKey("KEYBOARD_LAYOUT")); // KEY not at a boundary
});

// ─── scanContent ──────────────────────────────────────────────────────────────

test("scanContent: flags a known secret value appearing verbatim", (t) => {
  const secret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
  const findings = scanContent(
    "/p/.env.example",
    `STRIPE_SECRET_KEY=${secret}\n`,
    new Map([[secret, "STRIPE_SECRET_KEY"]]),
  );
  t.is(findings.length, 1);
  t.is(findings[0].key, "STRIPE_SECRET_KEY");
  t.is(findings[0].kind, "known-secret");
});

test("scanContent: finds a known secret in a non-env file", (t) => {
  const secret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
  const findings = scanContent(
    "/p/config.json",
    `{ "stripeKey": "${secret}" }`,
    new Map([[secret, "STRIPE_SECRET_KEY"]]),
  );
  t.is(findings.length, 1);
  t.is(findings[0].kind, "known-secret");
});

test("scanContent: secret-shaped heuristic flags real values in env files", (t) => {
  const findings = scanContent(
    "/p/.env.example",
    "API_KEY=a1b2c3d4e5f6g7h8\n",
    new Map(),
  );
  t.is(findings.length, 1);
  t.is(findings[0].key, "API_KEY");
  t.is(findings[0].kind, "secret-shaped");
});

test("scanContent: secret-shaped heuristic ignores placeholders", (t) => {
  const findings = scanContent(
    "/p/.env.example",
    "API_KEY=<your-api-key>\nDB_PASSWORD=changeme\n",
    new Map(),
  );
  t.is(findings.length, 0);
});

test("scanContent: heuristic does not apply to non-env files", (t) => {
  const findings = scanContent(
    "/p/config.js",
    "const API_KEY = 'a1b2c3d4e5f6g7h8';\n",
    new Map(),
  );
  t.is(findings.length, 0);
});

test("scanContent: a key that is both known and secret-shaped yields one known-secret finding", (t) => {
  // STRIPE_SECRET_KEY is both secret-shaped *and* a known value — it must
  // surface once as known-secret, not twice. API_KEY is secret-shaped but its
  // value is a placeholder, so it must not be flagged at all.
  const secret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
  const findings = scanContent(
    "/p/.env.example",
    `STRIPE_SECRET_KEY=${secret}\nAPI_KEY=<placeholder>\n`,
    new Map([[secret, "STRIPE_SECRET_KEY"]]),
  );
  t.is(findings.length, 1);
  t.is(findings[0].key, "STRIPE_SECRET_KEY");
  t.is(findings[0].kind, "known-secret");
});

// ─── filesToScan ──────────────────────────────────────────────────────────────

test("filesToScan: returns an empty array outside a git repo", (t) => {
  const dir = tmpDir();
  try {
    t.deepEqual(filesToScan(dir), []);
  } finally {
    cleanup(dir);
  }
});

test("filesToScan: returns staged files when something is staged", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = (/** @type {string[]} */ args) =>
      spawnSync("git", args, { cwd: dir });
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    fs.writeFileSync(path.join(dir, "untracked.txt"), "nope\n");
    git(["add", ".env.example"]);
    const files = filesToScan(dir);
    t.is(files.length, 1);
    t.true(files[0].endsWith(".env.example"));
  } finally {
    cleanup(dir);
  }
});

test("filesToScan: falls back to all tracked files when nothing is staged", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = (/** @type {string[]} */ args) =>
      spawnSync("git", args, { cwd: dir });
    fs.writeFileSync(path.join(dir, ".env.example"), "FOO=bar\n");
    git(["add", ".env.example"]);
    git(["commit", "-m", "add example"]);
    const files = filesToScan(dir);
    // .gitignore (committed by tmpGitDir) + .env.example
    t.true(files.some((f) => f.endsWith(".env.example")));
    t.true(files.some((f) => f.endsWith(".gitignore")));
  } finally {
    cleanup(dir);
  }
});

// ─── checkEnv ─────────────────────────────────────────────────────────────────

test("checkEnv: flags a committed file holding a known secret", (t) => {
  const dir = tmpDir();
  try {
    const rootEnv = path.join(dir, "root.env");
    const secret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${secret}\n`);
    const example = path.join(dir, ".env.example");
    fs.writeFileSync(example, `STRIPE_SECRET_KEY=${secret}\n`);
    const findings = checkEnv(dir, { rootEnvPath: rootEnv, files: [example] });
    t.is(findings.length, 1);
    t.is(findings[0].kind, "known-secret");
    t.is(findings[0].key, "STRIPE_SECRET_KEY");
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: returns no findings when example uses a placeholder", (t) => {
  const dir = tmpDir();
  try {
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, "STRIPE_SECRET_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc\n");
    const example = path.join(dir, ".env.example");
    fs.writeFileSync(example, "STRIPE_SECRET_KEY=sk_test_placeholder123\n");
    const findings = checkEnv(dir, { rootEnvPath: rootEnv, files: [example] });
    t.is(findings.length, 0);
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: secret-shaped heuristic works without a root .env", (t) => {
  const dir = tmpDir();
  try {
    const example = path.join(dir, ".env.example");
    fs.writeFileSync(example, "API_KEY=a1b2c3d4e5f6g7h8\n");
    const findings = checkEnv(dir, {
      rootEnvPath: "/nonexistent/.env",
      files: [example],
    });
    t.is(findings.length, 1);
    t.is(findings[0].kind, "secret-shaped");
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: skips files that cannot be read", (t) => {
  const dir = tmpDir();
  try {
    const findings = checkEnv(dir, {
      rootEnvPath: "/nonexistent/.env",
      files: [path.join(dir, "does-not-exist")],
    });
    t.deepEqual(findings, []);
  } finally {
    cleanup(dir);
  }
});

// ─── formatCheckFindings (MCP) ────────────────────────────────────────────────

test("formatCheckFindings: returns a clean message when no findings", (t) =>
  t.is(formatCheckFindings([]), "No leaked secrets detected."));

test("formatCheckFindings: describes a known-secret finding", (t) => {
  const text = formatCheckFindings([
    { file: "/p/.env.example", key: "STRIPE_SECRET_KEY", kind: "known-secret" },
  ]);
  t.true(text.includes("/p/.env.example"));
  t.true(text.includes("STRIPE_SECRET_KEY"));
  t.true(text.includes("matching your local ~/.env"));
});

test("formatCheckFindings: describes a secret-shaped finding", (t) => {
  const text = formatCheckFindings([
    { file: "/p/.env.example", key: "API_KEY", kind: "secret-shaped" },
  ]);
  t.true(text.includes("looks like a secret"));
});

// ─── checkEnvToolHandler (MCP) ─────────────────────────────────────────────────

test("checkEnvToolHandler: reports a finding through the real git path", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = (/** @type {string[]} */ args) =>
      spawnSync("git", args, { cwd: dir });
    const rootEnv = path.join(dir, "root.env");
    const secret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${secret}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), `STRIPE_SECRET_KEY=${secret}\n`);
    git(["add", ".env.example"]);
    const { content } = checkEnvToolHandler({ dir, root_env_path: rootEnv });
    t.is(content[0].type, "text");
    t.true(content[0].text.includes("Possible secret detected"));
    t.true(content[0].text.includes("STRIPE_SECRET_KEY"));
  } finally {
    cleanup(dir);
  }
});

test("checkEnvToolHandler: clean repo returns the no-findings message", (t) => {
  const dir = tmpDir();
  try {
    const { content } = checkEnvToolHandler({
      dir,
      root_env_path: "/nonexistent/.env",
    });
    t.is(content[0].type, "text");
    t.is(content[0].text, "No leaked secrets detected.");
  } finally {
    cleanup(dir);
  }
});

// ─── shared fixtures for git/CLI integration ──────────────────────────────────

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
const LIVE_SECRET = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";

/** Run the real CLI binary in `dir`. Returns the spawnSync result. */
function runCli(/** @type {string} */ dir, /** @type {string[]} */ args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

/** git command bound to a directory. */
const gitIn = (/** @type {string} */ dir) => (/** @type {string[]} */ args) =>
  spawnSync("git", args, { cwd: dir });

// ─── cli.js --check exit-code contract ────────────────────────────────────────
// The pre-commit/CI promise lives entirely in the exit code, so it is pinned
// here against the real binary rather than only the library functions.

test("cli --check: exits 0 and silent when staged files are clean", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), "STRIPE_SECRET_KEY=sk_test_placeholder\n");
    git(["add", ".env.example"]);
    const { status, stdout, stderr } = runCli(dir, ["--check", "--root", rootEnv]);
    t.is(status, 0);
    t.is(stdout.trim(), "");
    t.is(stderr.trim(), "");
  } finally {
    cleanup(dir);
  }
});

test("cli --check: exits 1 and reports when a staged file leaks a known secret", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    git(["add", ".env.example"]);
    const { status, stderr } = runCli(dir, ["--check", "--root", rootEnv]);
    t.is(status, 1);
    t.true(stderr.includes("Possible secret detected"));
    t.true(stderr.includes("STRIPE_SECRET_KEY"));
    // read-only: --check must never write a .env
    t.false(fs.existsSync(path.join(dir, ".env")));
  } finally {
    cleanup(dir);
  }
});

test("cli --check: exits 1 on a secret-shaped key when no root env exists", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    fs.writeFileSync(path.join(dir, ".env.example"), "API_KEY=a1b2c3d4e5f6g7h8\n");
    git(["add", ".env.example"]);
    const { status, stderr } = runCli(dir, ["--check", "--root", path.join(dir, "nope.env")]);
    t.is(status, 1);
    t.true(stderr.includes("API_KEY"));
  } finally {
    cleanup(dir);
  }
});

test("cli --check: exits 0 outside a git repository", (t) => {
  const dir = tmpDir();
  try {
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    const { status } = runCli(dir, ["--check", "--root", rootEnv]);
    t.is(status, 0);
  } finally {
    cleanup(dir);
  }
});

test("cli (copy): exits 1 and blocks when .env is tracked by git", (t) => {
  const dir = tmpGitDir({ gitignore: "*.log\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, "");
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=tracked\n");
    git(["add", ".env"]);
    git(["commit", "-m", "accidentally commit .env"]);
    fs.writeFileSync(path.join(dir, ".env.example"), "SECRET=example\n");
    fs.rmSync(path.join(dir, ".env"));
    const { status, stderr } = runCli(dir, ["--root", rootEnv]);
    t.is(status, 1);
    t.true(stderr.includes("Blocked"));
    t.false(fs.existsSync(path.join(dir, ".env")));
  } finally {
    cleanup(dir);
  }
});

// ─── checkEnv end-to-end through git (no files override) ──────────────────────
// The library tests above inject `files`; these exercise the real production
// path checkEnv → filesToScan → git.

test("checkEnv: flags a staged file via the real git path", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    git(["add", ".env.example"]);
    const findings = checkEnv(dir, { rootEnvPath: rootEnv });
    t.is(findings.length, 1);
    t.is(findings[0].kind, "known-secret");
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: does NOT flag a gitignored real .env (core safety claim)", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    // The real secret lives in a gitignored .env — it must never be scanned.
    fs.writeFileSync(path.join(dir, ".env"), `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    // The tracked template carries only a placeholder.
    fs.writeFileSync(path.join(dir, ".env.example"), "STRIPE_SECRET_KEY=sk_test_placeholder\n");
    git(["add", ".env.example"]);
    const findings = checkEnv(dir, { rootEnvPath: rootEnv });
    t.deepEqual(findings, []);
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: all-tracked fallback flags a committed leak when nothing is staged", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    git(["add", ".env.example"]);
    git(["commit", "-m", "leak"]); // committed, so nothing is staged
    const findings = checkEnv(dir, { rootEnvPath: rootEnv });
    t.is(findings.length, 1);
    t.is(findings[0].kind, "known-secret");
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: aggregates findings across multiple staged files", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    const gh = "ghp_16C7e42F292c6912E7710c838347Ae178B4a";
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\nGITHUB_TOKEN=${gh}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    fs.mkdirSync(path.join(dir, "svc"));
    fs.writeFileSync(path.join(dir, "svc", "config.json"), `{ "gh": "${gh}" }`);
    git(["add", ".env.example", "svc/config.json"]);
    const findings = checkEnv(dir, { rootEnvPath: rootEnv });
    t.is(findings.length, 2);
    t.deepEqual(
      findings.map((f) => f.key).sort(),
      ["GITHUB_TOKEN", "STRIPE_SECRET_KEY"],
    );
  } finally {
    cleanup(dir);
  }
});

test("checkEnv: is read-only — leaves the working tree untouched", (t) => {
  const dir = tmpGitDir({ gitignore: ".env\n" });
  try {
    const git = gitIn(dir);
    const rootEnv = path.join(dir, "root.env");
    fs.writeFileSync(rootEnv, `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    fs.writeFileSync(path.join(dir, ".env.example"), `STRIPE_SECRET_KEY=${LIVE_SECRET}\n`);
    git(["add", ".env.example"]);
    const before = fs.readdirSync(dir).sort();
    checkEnv(dir, { rootEnvPath: rootEnv });
    t.deepEqual(fs.readdirSync(dir).sort(), before);
  } finally {
    cleanup(dir);
  }
});

// ─── real-world secret-format corpus ──────────────────────────────────────────
// The professional bar for a secret scanner: validate against the formats that
// actually leak, and against the example/placeholder shapes that must not trip.

const REAL_SECRET_FORMATS = [
  ["AWS access key id", "AKIA1234567890ABCDEF"],
  ["AWS secret access key", "wJalrXUtnFEMIbPxRfiCYz9aBcDeFgHiJkLmNoPq"],
  ["GitHub PAT (classic)", "ghp_16C7e42F292c6912E7710c838347Ae178B4a"],
  ["GitHub fine-grained PAT", "github_pat_11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ12"],
  ["Slack-style token (synthetic)", "xoxb-0000-synthetic-fixture-not-a-real-token-0000"],
  ["Google API key", "AIzaSyA1B2C3D4E5F6G7H8I9J0KLMNOPQRSTUVwx"],
  ["OpenAI key", "sk-AbCdEf1234567890GhIjKlMnOpQrStUvWxYz"],
  ["Stripe live key", "sk_live_4eC39HqLyjWDarjtT1zdp7dc"],
  ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"],
  ["hex digest", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b"],
  ["base64 blob", "c2VjcmV0LXZhbHVlLXRoYXQtaXMtZmFpcmx5LWxvbmc="],
];

for (const [label, value] of REAL_SECRET_FORMATS) {
  test(`isPlaceholderValue: ${label} is treated as a real secret`, (t) => {
    t.false(isPlaceholderValue(value), value);
  });
}

const PLACEHOLDER_FORMATS = [
  ["Stripe test key", "sk_test_placeholderkey"],
  ["angle-bracket", "<your-api-key>"],
  ["your_ prefix + _here", "your_token_here"],
  ["changeme", "changeme"],
  ["change-me phrase", "change-me-please"],
  ["x run", "xxxxxxxx"],
  ["zero run", "00000000"],
  ["dash run", "--------"],
  ["template braces", "{{ APP_SECRET }}"],
  ["literal placeholder", "placeholder"],
  ["example value", "example-value"],
  ["redacted", "REDACTED"],
  ["too short", "abc"],
];

for (const [label, value] of PLACEHOLDER_FORMATS) {
  test(`isPlaceholderValue: ${label} is treated as a placeholder`, (t) => {
    t.true(isPlaceholderValue(value), value);
  });
}

const DETECT_CORPUS = [
  ["AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMIbPxRfiCYz9aBcDeFgHiJkLmNoPq"],
  ["GITHUB_TOKEN", "ghp_16C7e42F292c6912E7710c838347Ae178B4a"],
  ["OPENAI_API_KEY", "sk-AbCdEf1234567890GhIjKlMnOpQrStUvWxYz"],
  ["STRIPE_SECRET_KEY", "sk_live_4eC39HqLyjWDarjtT1zdp7dc"],
];

for (const [key, value] of DETECT_CORPUS) {
  test(`scanContent: detects a leaked ${key} value (plain and quoted)`, (t) => {
    const secretValues = new Map([[value, key]]);
    const plain = scanContent("/p/.env.example", `${key}=${value}\n`, secretValues);
    t.is(plain.length, 1);
    t.is(plain[0].kind, "known-secret");
    const quoted = scanContent("/p/config.json", `{ "k": "${value}" }`, secretValues);
    t.is(quoted.length, 1);
    t.is(quoted[0].kind, "known-secret");
  });
}

// ─── isPlaceholderValue boundaries ────────────────────────────────────────────

test("isPlaceholderValue: length threshold is 8 characters", (t) => {
  t.true(isPlaceholderValue("1234567")); // 7 → placeholder
  t.false(isPlaceholderValue("12345678")); // 8 → real
});

// ─── isSecretShapedKey blind-spot coverage ────────────────────────────────────

test("isSecretShapedKey: matches compound and concatenated secret keys", (t) => {
  for (const k of [
    "SECRET_KEY_BASE",
    "AWS_ACCESS_KEY_ID",
    "APIKEY",
    "PASSPHRASE",
    "ACCESS_TOKEN",
    "OAUTH_CLIENT_SECRET",
    "X-Auth-Token",
  ]) {
    t.true(isSecretShapedKey(k), k);
  }
});

test("isSecretShapedKey: ignores lookalikes that merely contain a secret word", (t) => {
  for (const k of [
    "KEYBOARD_LAYOUT",
    "MONKEY_BUSINESS",
    "TURKEY",
    "DATABASE_URL",
    "PUBLIC_URL",
    "PORT",
    "NODE_ENV",
  ]) {
    t.false(isSecretShapedKey(k), k);
  }
});
