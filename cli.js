#!/usr/bin/env node
// @ts-check

import path from "node:path";

import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { checkEnv, copyEnv } from "./index.js";

const argv = yargs(hideBin(process.argv))
  .scriptName("envoy")
  .usage("$0 [options]", "Copy values from your root ~/.env into project .env files using .env.example as a template.")
  .option("force", {
    alias: "f",
    type: "boolean",
    description: "Overwrite existing .env files",
    default: false,
  })
  .option("dry-run", {
    alias: "n",
    type: "boolean",
    description: "Preview what would be written without creating any files",
    default: false,
  })
  .option("root", {
    alias: "r",
    type: "string",
    description: "Path to root .env file (default: ~/.env)",
  })
  .option("dir", {
    alias: "d",
    type: "string",
    description: "Directory to scan (default: current directory)",
  })
  .option("skip-audit", {
    alias: "s",
    type: "boolean",
    description: "Skip the gitignore and git-tracking safety checks",
    default: false,
  })
  .option("check", {
    alias: "c",
    type: "boolean",
    description:
      "Validate that no local ~/.env secrets appear in committed files (read-only; pre-commit friendly)",
    default: false,
  })
  .help()
  .parseSync();

const dir = argv.dir ? path.resolve(/** @type {string} */ (argv.dir)) : process.cwd();

/** Format an absolute path relative to the cwd for friendlier output. */
const rel = (/** @type {string} */ p) => path.relative(process.cwd(), p) || p;

// ─── --check: read-only secret validation ──────────────────────────────────
if (argv.check) {
  const findings = checkEnv(dir, {
    rootEnvPath: /** @type {string | undefined} */ (argv.root),
  });

  // Exit zero silently when nothing is wrong — CI/pre-commit friendly.
  if (findings.length === 0) process.exit(0);

  for (const finding of findings) {
    const reason =
      finding.kind === "known-secret"
        ? `${finding.key} contains a value matching your local ~/.env`
        : `${finding.key} looks like a secret and holds a non-placeholder value`;
    console.error(
      chalk.yellow(`⚠ Possible secret detected in ${rel(finding.file)}:\n  ${reason}`),
    );
  }

  console.error(chalk.dim("\nResolve these before committing, or use a placeholder value."));
  process.exit(1);
}

const results = copyEnv(dir, {
  force: /** @type {boolean} */ (argv.force),
  dryRun: /** @type {boolean} */ (argv["dry-run"]),
  rootEnvPath: /** @type {string | undefined} */ (argv.root),
  skipAudit: /** @type {boolean} */ (argv["skip-audit"]),
});

if (results.length === 0) {
  console.log(chalk.yellow("No .env.example files found."));
  process.exit(0);
}

let hasBlocked = false;

for (const result of results) {
  if (result.status === "blocked") {
    hasBlocked = true;
    console.error(
      chalk.red(
        `🚨 Blocked ${result.envPath} — this file is tracked by git. Remove it from version control before proceeding:\n` +
        `   git rm --cached ${result.envPath}`,
      ),
    );
  } else if (result.status === "skipped") {
    console.log(
      chalk.dim(
        `⏭  Skipped ${result.envPath} — already exists (use --force to overwrite)`,
      ),
    );
  } else if (result.status === "would-create") {
    console.log(chalk.cyan(`🔍 Would create ${result.envPath}:`));
    console.log(chalk.dim(result.content));
  } else {
    console.log(chalk.green(`✨ Created ${result.envPath}`));
  }

  if (result.audit?.isGitRepo && !result.audit.isGitignored && result.status !== "blocked") {
    console.warn(
      chalk.yellow(
        `⚠️  ${result.envPath} is not covered by .gitignore — add it to prevent accidentally committing secrets`,
      ),
    );
  }
}

if (hasBlocked) process.exit(1);
