#!/usr/bin/env node
// @ts-check

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkEnv, copyEnv } from "./index.js";
import packageJSON from "./package.json" with { type: 'json' };

/**
 * Format an array of CopyEnvResults into a human-readable string.
 *
 * @param {import('./index.js').CopyEnvResult[]} results
 * @returns {string}
 */
export function formatResults(results) {
  if (results.length === 0) return "No .env.example files found.";

  return results
    .map((r) => {
      /** @type {string[]} */
      const lines = [];

      if (r.status === "blocked") {
        lines.push(
          `Blocked ${r.envPath} — this file is tracked by git and cannot be overwritten. ` +
          `Run: git rm --cached ${r.envPath}`,
        );
      } else if (r.status === "skipped") {
        lines.push(`Skipped ${r.envPath} — already exists (use force: true to overwrite)`);
      } else if (r.status === "would-create") {
        lines.push(`Would create ${r.envPath}:\n${r.content}`);
      } else {
        lines.push(`Created ${r.envPath}`);
      }

      if (r.audit?.isGitRepo && !r.audit.isGitignored && r.status !== "blocked") {
        lines.push(`Warning: ${r.envPath} is not covered by .gitignore`);
      }

      return lines.join("\n");
    })
    .join("\n");
}

/**
 * Format an array of CheckFindings into a human-readable string.
 *
 * @param {import('./index.js').CheckFinding[]} findings
 * @returns {string}
 */
export function formatCheckFindings(findings) {
  if (findings.length === 0) return "No leaked secrets detected.";

  return findings
    .map((f) => {
      const reason =
        f.kind === "known-secret"
          ? `${f.key} contains a value matching your local ~/.env`
          : `${f.key} looks like a secret and holds a non-placeholder value`;
      return `Possible secret detected in ${f.file}: ${reason}`;
    })
    .join("\n");
}

const server = new McpServer({
  name: packageJSON.name,
  version: packageJSON.version,
});

/**
 * MCP tool handler for copy_env. Extracted for testability.
 *
 * @param {{ dir?: string, force?: boolean, dry_run?: boolean, root_env_path?: string }} args
 * @returns {{ content: Array<{ type: string, text: string }> }}
 */
export function copyEnvToolHandler({ dir, force, dry_run, root_env_path, skip_audit } = {}) {
  const results = copyEnv(dir, {
    force,
    dryRun: dry_run,
    rootEnvPath: root_env_path,
    skipAudit: skip_audit,
  });

  return {
    content: [{ type: "text", text: formatResults(results) }],
  };
}

/**
 * MCP tool handler for check_env. Extracted for testability.
 *
 * @param {{ dir?: string, root_env_path?: string }} [args]
 * @returns {{ content: Array<{ type: string, text: string }> }}
 */
export function checkEnvToolHandler({ dir, root_env_path } = {}) {
  const findings = checkEnv(dir, { rootEnvPath: root_env_path });

  return {
    content: [{ type: "text", text: formatCheckFindings(findings) }],
  };
}

server.registerTool(
  "check_env",
  {
    description:
      "Validate, read-only, that no real secrets have leaked into committed files. " +
      "Scans files staged for commit (or all tracked files when nothing is staged), " +
      "cross-references their contents against the values in the root .env, and flags any " +
      "verbatim matches. Even without a root .env, flags secret-shaped keys " +
      "(*_KEY, *_SECRET, *_TOKEN, *_PASSWORD) holding non-placeholder values. Writes nothing.",
    inputSchema: {
      dir: z
        .string()
        .optional()
        .describe("Directory to scan (default: current working directory)"),
      root_env_path: z
        .string()
        .optional()
        .describe("Path to the root .env file to source secret values from (default: ~/.env)"),
    },
  },
  checkEnvToolHandler,
);

server.registerTool(
  "copy_env",
  {
    description:
      "Copy values from a root .env file into project .env files, using .env.example files as templates. " +
      "Searches the given directory recursively (excluding node_modules), and for each .env.example found " +
      "writes a .env alongside it, substituting values from the root .env where keys match.",
    inputSchema: {
      dir: z
        .string()
        .optional()
        .describe("Directory to scan (default: current working directory)"),
      force: z
        .boolean()
        .optional()
        .describe("Overwrite existing .env files (default: false)"),
      dry_run: z
        .boolean()
        .optional()
        .describe("Preview changes without writing any files (default: false)"),
      root_env_path: z
        .string()
        .optional()
        .describe("Path to the root .env file to source values from (default: ~/.env)"),
      skip_audit: z
        .boolean()
        .optional()
        .describe("Skip the gitignore and git-tracking safety checks (default: false)"),
    },
  },
  copyEnvToolHandler,
);

// Only start the stdio transport when this file is run directly.
/* c8 ignore next 3 */
if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await server.connect(new StdioServerTransport());
}
