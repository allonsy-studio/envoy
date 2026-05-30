// @ts-check

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Parse a single line from a .env file into its key and value.
 * Returns null for comments, blank lines, or lines without `=`.
 *
 * @param {string} line
 * @returns {{ key: string, value: string } | null}
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  if (!key) return null;

  return { key, value: trimmed.slice(eqIndex + 1) };
}

/**
 * Parse a .env file into a Map of key → value.
 * Returns an empty Map if the file does not exist.
 *
 * @param {string} filePath
 * @returns {Map<string, string>}
 */
export function parseEnvFile(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;

  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const parsed = parseLine(line);
    if (parsed) map.set(parsed.key, parsed.value);
  }

  return map;
}

/**
 * Recursively find all `.env.example` files under `dir`, excluding `node_modules`.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function findExampleFiles(dir) {
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findExampleFiles(fullPath));
    } else if (entry.name === ".env.example") {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Build the output content for a `.env` file by merging `.env.example` lines
 * with values sourced from the root env map. Comments and blank lines are
 * preserved as-is. Keys present in rootEnv have their values replaced.
 *
 * @param {string} examplePath
 * @param {Map<string, string>} rootEnv
 * @returns {string}
 */
export function buildEnvContent(examplePath, rootEnv) {
  const lines = fs.readFileSync(examplePath, "utf8").split("\n");

  return lines
    .map((line) => {
      const parsed = parseLine(line);
      if (!parsed) return line;
      return rootEnv.has(parsed.key)
        ? `${parsed.key}=${rootEnv.get(parsed.key)}`
        : line;
    })
    .join("\n");
}

/**
 * @typedef {Object} AuditResult
 * @property {boolean} isGitRepo     — false when the path is not inside a git repository (remaining fields are false)
 * @property {boolean} isGitignored  — true when `.env` is covered by a gitignore rule
 * @property {boolean} isTracked     — true when `.env` is currently tracked by git (writing would expose secrets)
 */

/**
 * Audit the prospective `.env` path for git safety.
 *
 * Uses `git check-ignore` to verify the file is gitignored, and `git ls-files`
 * to confirm it is not already tracked. Both commands are no-ops when git is
 * unavailable or the path is outside a repository.
 *
 * @param {string} envPath  Absolute path to the `.env` file (need not exist yet)
 * @returns {AuditResult}
 */
export function auditEnvFile(envPath) {
  const cwd = path.dirname(envPath);
  const git = (/** @type {string[]} */ args) =>
    spawnSync("git", args, { cwd, encoding: "utf8" });

  if (git(["rev-parse", "--git-dir"]).status !== 0) {
    return { isGitRepo: false, isGitignored: false, isTracked: false };
  }

  return {
    isGitRepo: true,
    isGitignored: git(["check-ignore", "-q", envPath]).status === 0,
    isTracked: git(["ls-files", "--error-unmatch", envPath]).status === 0,
  };
}

/**
 * @typedef {Object} CopyEnvOptions
 * @property {boolean} [force]       Overwrite an existing `.env` file
 * @property {boolean} [dryRun]      Return a preview without writing any files
 * @property {string}  [rootEnvPath] Path to the root `.env` (default: `~/.env`)
 * @property {boolean} [skipAudit]   Skip gitignore and tracking safety checks
 */

/**
 * @typedef {'created' | 'skipped' | 'would-create' | 'blocked'} CopyEnvStatus
 *
 * @typedef {Object} CopyEnvResult
 * @property {string}        examplePath
 * @property {string}        envPath
 * @property {CopyEnvStatus} status
 * @property {string}        [content]  Present when status is `'would-create'`
 * @property {AuditResult}   [audit]    Present when audit was run
 */

/**
 * Process a single `.env.example` file, writing the merged `.env` alongside it.
 *
 * @param {string}              examplePath
 * @param {Map<string, string>} rootEnv
 * @param {CopyEnvOptions}      [options]
 * @returns {CopyEnvResult}
 */
export function processExampleFile(examplePath, rootEnv, options = {}) {
  const envPath = path.join(path.dirname(examplePath), ".env");

  if (!options.force && fs.existsSync(envPath)) {
    return { examplePath, envPath, status: "skipped" };
  }

  const audit = options.skipAudit ? undefined : auditEnvFile(envPath);

  if (audit?.isTracked) {
    return { examplePath, envPath, status: "blocked", audit };
  }

  const content = buildEnvContent(examplePath, rootEnv);

  if (options.dryRun) {
    return { examplePath, envPath, status: "would-create", content, audit };
  }

  fs.writeFileSync(envPath, content, "utf8");
  return { examplePath, envPath, status: "created", audit };
}

/**
 * Find all `.env.example` files under `dir` and copy matching values from the
 * root `.env` into each project's `.env` file.
 *
 * @param {string}         [dir]     Directory to scan (default: `process.cwd()`)
 * @param {CopyEnvOptions} [options]
 * @returns {CopyEnvResult[]}
 */
export function copyEnv(dir = process.cwd(), options = {}) {
  const rootEnvPath = options.rootEnvPath ?? path.join(os.homedir(), ".env");
  const rootEnv = parseEnvFile(rootEnvPath);
  return findExampleFiles(dir).map((examplePath) =>
    processExampleFile(examplePath, rootEnv, options),
  );
}

// ─── check ────────────────────────────────────────────────────────────────

/**
 * Patterns that mark a value as a non-secret placeholder rather than a real
 * credential. Matched against the value with surrounding quotes stripped.
 */
const PLACEHOLDER_PATTERNS = [
  /^(x+|\.+|-+|\*+|0+)$/i, // xxxx, ...., ----, ****, 0000
  /^<.*>$/, // <your-api-key>
  /^\{\{.*\}\}$/, // {{ template }}
  /^(your|my|some|the|a|an)[-_ ]/i, // your_key, my-token
  /change[-_ ]?me/i, // changeme, change-me
  /\b(placeholder|example|dummy|sample|todo|fixme|redacted|none)\b/i,
  /^sk_test_/, // Stripe test keys are safe to commit
  /[-_]here$/i, // value_here
];

/**
 * Decide whether a value is a placeholder/non-secret. Values that are short,
 * blank, or match a known placeholder shape are treated as safe — this is what
 * keeps `--check` from flagging the example values that belong in `.env.example`.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isPlaceholderValue(value) {
  const v = value.trim().replace(/^["']|["']$/g, "");
  if (v.length < 8) return true; // too short / low-entropy to be a real secret
  return PLACEHOLDER_PATTERNS.some((re) => re.test(v));
}

/**
 * Whole words (between `_`/`-` separators) that mark a key as holding a secret.
 * Matching on delimited tokens — rather than a substring — flags `SECRET_KEY_BASE`
 * and `AWS_ACCESS_KEY_ID` while leaving `KEYBOARD_LAYOUT` and `MONKEY_BUSINESS`
 * alone.
 */
const SECRET_KEY_WORDS = new Set([
  "KEY", "KEYS", "APIKEY", "APIKEYS",
  "SECRET", "SECRETS",
  "TOKEN", "TOKENS",
  "PASSWORD", "PASSWD", "PASSPHRASE", "PWD",
  "CREDENTIAL", "CREDENTIALS",
  "PRIVATE", "AUTH",
]);

/**
 * Whether a key name looks like it should hold a secret (e.g. `*_KEY`,
 * `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `APIKEY`, `SECRET_KEY_BASE`).
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretShapedKey(key) {
  return key
    .toUpperCase()
    .split(/[_-]+/)
    .some((token) => SECRET_KEY_WORDS.has(token));
}

/**
 * Whether a path is an env file (`.env`, `.env.example`, `.env.local`, …).
 * The secret-shaped heuristic only applies to these.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isEnvFile(filePath) {
  const base = path.basename(filePath);
  return base === ".env" || base.startsWith(".env.");
}

/**
 * Determine which files `--check` should scan. Prefers files staged for commit
 * (true pre-commit semantics); when nothing is staged, falls back to every
 * tracked file so it doubles as an ad-hoc audit. Returns an empty array when
 * git is unavailable or `dir` is outside a repository. Paths are absolute.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function filesToScan(dir) {
  const git = (/** @type {string[]} */ args) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8" });

  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) return [];
  const repoRoot = top.stdout.trim();

  const toPaths = (/** @type {string} */ out) =>
    out
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => path.resolve(repoRoot, f));

  // Both commands emit paths relative to the repository root.
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACM"]);
  const stagedFiles = staged.status === 0 ? toPaths(staged.stdout) : [];
  if (stagedFiles.length > 0) return stagedFiles;

  const tracked = git(["ls-files", "--full-name"]);
  return tracked.status === 0 ? toPaths(tracked.stdout) : [];
}

/**
 * @typedef {'known-secret' | 'secret-shaped'} CheckFindingKind
 *   - `known-secret`: the value matches one defined in the root `~/.env`
 *   - `secret-shaped`: the key looks secret and holds a non-placeholder value
 *
 * @typedef {Object} CheckFinding
 * @property {string}           file  Absolute path to the offending file
 * @property {string}           key   Env key associated with the match
 * @property {CheckFindingKind} kind
 */

/**
 * Scan a single file's contents for leaked secrets. Reports at most one finding
 * per key (a known-secret match takes precedence over the secret-shaped
 * heuristic). Pure — does no I/O — so it can be tested in isolation.
 *
 * @param {string}              filePath
 * @param {string}              content
 * @param {Map<string, string>} secretValues  Map of secret value → its root key
 * @returns {CheckFinding[]}
 */
export function scanContent(filePath, content, secretValues) {
  /** @type {CheckFinding[]} */
  const findings = [];
  const seen = new Set();
  const add = (/** @type {string} */ key, /** @type {CheckFindingKind} */ kind) => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: filePath, key, kind });
  };

  // 1. A local secret value appearing verbatim in a committed file.
  for (const [value, key] of secretValues) {
    if (content.includes(value)) add(key, "known-secret");
  }

  // 2. Secret-shaped env assignments with a real-looking value. Only meaningful
  //    for env files, where `KEY=value` lines carry intent.
  if (isEnvFile(filePath)) {
    for (const line of content.split("\n")) {
      const parsed = parseLine(line);
      if (parsed && isSecretShapedKey(parsed.key) && !isPlaceholderValue(parsed.value)) {
        add(parsed.key, "secret-shaped");
      }
    }
  }

  return findings;
}

/**
 * @typedef {Object} CheckEnvOptions
 * @property {string}   [rootEnvPath] Path to the root `.env` (default: `~/.env`)
 * @property {string[]} [files]       Override the scanned file list (default: git staged/tracked)
 */

/**
 * Validate that no real secrets have leaked into committed files. Read-only:
 * never writes or modifies anything. Cross-references file contents against the
 * values in the root `~/.env`, and — even when no root env exists — flags
 * secret-shaped keys holding non-placeholder values.
 *
 * @param {string}          [dir]     Directory to scan (default: `process.cwd()`)
 * @param {CheckEnvOptions} [options]
 * @returns {CheckFinding[]}
 */
export function checkEnv(dir = process.cwd(), options = {}) {
  const rootEnvPath = options.rootEnvPath ?? path.join(os.homedir(), ".env");
  const rootEnv = parseEnvFile(rootEnvPath);

  /** @type {Map<string, string>} value → key, for real (non-placeholder) secrets */
  const secretValues = new Map();
  for (const [key, value] of rootEnv) {
    if (!isPlaceholderValue(value)) secretValues.set(value, key);
  }

  const files = options.files ?? filesToScan(dir);

  /** @type {CheckFinding[]} */
  const findings = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue; // deleted, unreadable, or binary — nothing to scan
    }
    findings.push(...scanContent(file, content, secretValues));
  }

  return findings;
}
