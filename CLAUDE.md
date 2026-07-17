# Envoy

Single-package Node CLI / library / MCP server (`@allons-y/envoy`). Copies values
from a root `~/.env` into project `.env` files using each `.env.example` as the
template, and provides a read-only `envoy --check` gate that blocks real secrets
from being committed. Local-first by design: no network calls, no config files,
no telemetry — keep it that way.

## Layout

Four flat files at the repo root — there is no `src/` directory:

- `index.js` — all core logic as small exported functions (JSDoc-typed)
- `cli.js` — yargs CLI wrapper (`envoy` bin)
- `mcp.js` — MCP server exposing `copy_env` / `check_env` tools (`envoy-mcp` bin)
- `test.js` — all AVA tests, covering both `index.js` and `mcp.js`

## Commands

Yarn 4 (see `packageManager` in package.json), Node >= 24, ESM only.

- `yarn test` — run AVA tests
- `yarn coverage` — tests with c8 coverage
- `yarn typecheck` — type-check the JSDoc annotations (`tsc -p jsconfig.json`)
- `yarn build:types` — generate `types/*.d.ts` from JSDoc

## Conventions

- Plain JavaScript with `// @ts-check` and JSDoc types — no TypeScript source.
  Published type definitions are generated from the JSDoc, so keep annotations
  on exported functions accurate and complete; `yarn typecheck` must pass.
- DO: keep code self-documenting. When a comment is needed, keep it brief and
  explain only the "why" the code can't show — never restate what the code does.
- Every exported function gets tests in `test.js`. Tests use real temp
  directories and real git repos (see the `tmpDir` / `tmpGitDir` helpers), not
  mocks — follow that pattern.
- Don't add dependencies casually; the project's pitch is small, auditable, and
  dependency-light.
- README.md: never edit between `weaver:*:START` / `weaver:*:END` markers —
  those blocks are auto-generated and synced by Weaver.
- Husky hooks run automatically: pre-commit → lint-staged (eslint --fix on
  js/json, prettier on markdown); commit-msg → commitlint.

## Commits and pull requests

Conventional Commits, enforced by commitlint. semantic-release runs on `main`:
the commit type drives the version bump (`feat` → minor, `fix` → patch,
`BREAKING CHANGE:` footer → major) and the commit body is lifted verbatim into
the release notes — write it for a human reader.

- Subject: `<type>(<optional-scope>): <imperative subject>` — lowercase, ≤100
  chars, no trailing period. Types: feat, fix, docs, chore, refactor, test, …
- Body: plain prose, wrapped ~72–80 chars — what changed and why it matters;
  for feature commits, also how it behaves and how edge cases are handled.
  Small commits may collapse to subject + one line + footer (`Closes #N`).
- PRs are squash-merged, so the PR title must itself be a valid conventional
  commit subject; the PR body should cover what/why and note test coverage.
- Do NOT append "Generated with Claude Code" / Co-Authored-By footers to
  commits or PRs.
