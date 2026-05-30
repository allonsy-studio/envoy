<div align="center">
  <img width="250" src="https://github.com/Allons-y-Studio/envoy/blob/main/logo-envoy.png?raw=true">
</div>
<h1 align="center">Envoy</h1>
<p align="center">
  <b>Environment setup, handled.</b>
</p>

<div align="center">

[![Tests][github-image]][github-url]
[![NPM version][npm-image]][npm-url]
[![Coverage][coverage-image]][coverage-url]

</div>

Envoy keeps your secrets where they belong: **in every project that needs them, and out of every commit that doesn't.** Set it once in `postinstall` and forget it — every fresh clone gets a complete `.env` automatically, while a read-only `--check` gate stops real secrets from sneaking into version control.

```sh
# Onboard — pull your real values into this project's .env
yarn dlx @allons-y/envoy
# ✨ Created /your/project/.env

# Guard — fail the commit if a real secret slipped into a tracked file
envoy --check
# ⚠ Possible secret detected in .env.example:
#   STRIPE_SECRET_KEY contains a value matching your local ~/.env
```

## The problem

Every project starts the same way: copy `.env.example` → `.env`, then hunt through Notion, 1Password, Slack history, or your own memory for the actual values. In a monorepo it's worse — five packages, five `.env.example` files, the same ritual repeated for each one.

If you keep a root `~/.env` with your real values (and you should), **envoy bridges the gap**. It reads your `.env.example` as a template, pulls matching keys from `~/.env`, and writes a complete `.env` alongside it — preserving every comment and blank line in the process. Then it stays on as a guardrail, making sure those real values never end up somewhere they can be committed.

## Envoy across your workflow

Envoy isn't a one-time script whose existence you forget — it's a standing part of every project's lifecycle. Wire it in once and it covers the whole loop:

| Stage       | How envoy runs         | What you get                                                           |
| ----------- | ---------------------- | ---------------------------------------------------------------------- |
| **Onboard** | `postinstall: "envoy"` | Every clone gets a complete, populated `.env` — zero manual setup      |
| **Develop** | `envoy --dry-run`      | Preview exactly what would be written before anything touches disk     |
| **Commit**  | `envoy --check`        | A read-only gate that blocks real secrets from reaching the repository |

Set up the `postinstall` hook once and onboarding is genuinely _set it and forget it_: new contributors run their package manager and get a working `.env` — no doc to follow, no values to track down, no "works on my machine."

## Features

- **Template-driven** — `.env.example` defines the shape; `~/.env` supplies the values
- **Monorepo-aware** — recursively finds every `.env.example` under your project root, skipping `node_modules`
- **Comment-preserving** — blank lines and `# comments` in `.env.example` are written through untouched
- **Incremental** — keys absent from `~/.env` fall back to the example value, so you can adopt it gradually
- **Two safety gates** — refuses to write into a git-tracked `.env`, and `--check` stops real secrets from being committed
- **Preview mode** — `--dry-run` shows exactly what would be written without touching the filesystem
- **MCP tool** — expose `copy_env` and `check_env` to any MCP-compatible host (Claude Desktop, Claude Code, etc.)

## Why you can run it everywhere

Standardizing a tool across every repo is a big ask, so envoy is built to earn that trust:

- **Local-first** — reads `~/.env` on your machine; **no network calls**, no accounts, no SaaS, no telemetry
- **Zero config** — nothing to author or maintain; sensible defaults out of the box
- **Idempotent** — skips any `.env` that already exists, so running it on every install is completely safe
- **Non-destructive** — never overwrites without `--force`, and missing keys fall back to the example value
- **Read-only where it counts** — `--dry-run` and `--check` never modify a single byte on disk
- **No lock-in** — it's just `.env` files; stop using envoy any time and nothing breaks
- **Small and tested** — the source is short, readable, and fully covered by tests

## Installation

### Prerequisites

Envoy reads from a root `~/.env` file on your machine. If you don't have one yet, create it and add any values you want shared across projects:

```sh
# ~/.env
DATABASE_URL=postgres://localhost:5432/mydb
STRIPE_SECRET_KEY=sk_test_...
OPENAI_API_KEY=sk-...
```

Any key that isn't in `~/.env` will fall back to the value in your `.env.example`, so you can add keys incrementally — you don't need to migrate everything up front.

### Try it without installing

Run envoy once in any project directory without adding it as a dependency:

```sh
yarn dlx @allons-y/envoy
npx @allons-y/envoy
pnpm dlx @allons-y/envoy
bunx @allons-y/envoy
```

### Add to a project

Install as a dev dependency to use envoy in scripts, hooks, or CI:

```sh
yarn add --dev @allons-y/envoy   # Yarn Berry
npm install --save-dev @allons-y/envoy
pnpm add --save-dev @allons-y/envoy
bun add --dev @allons-y/envoy
```

## Usage

### CLI

Run in any project root. Envoy will find every `.env.example` recursively and create the corresponding `.env`.

```sh
envoy
```

| Flag            | Alias | Description                                             |
| --------------- | ----- | ------------------------------------------------------- |
| `--force`       | `-f`  | Overwrite existing `.env` files                         |
| `--dry-run`     | `-n`  | Preview changes without writing any files               |
| `--root <path>` | `-r`  | Use a custom root env file (default: `~/.env`)          |
| `--dir <path>`  | `-d`  | Directory to scan (default: current directory)          |
| `--skip-audit`  | `-s`  | Skip the git safety checks                              |
| `--check`       | `-c`  | Validate committed files for leaked secrets (read-only) |
| `--help`        | `-h`  | Show help                                               |

**Examples:**

```sh
# Preview what would be created, without writing anything
envoy --dry-run

# Regenerate .env files from scratch
envoy --force

# Use a team-shared env file instead of ~/.env
envoy --root ./secrets/.env.shared

# Scan a specific directory
envoy --dir packages/api

# Validate that no secrets have leaked into committed files
envoy --check
```

## Set it and forget it

The highest-value place to run envoy is your project's `postinstall` script. Every contributor who clones the repo and runs their package manager gets a fully populated `.env` automatically — no onboarding doc to follow, no values to track down.

```json
{
	"scripts": {
		"postinstall": "envoy"
	}
}
```

This is the whole "set it and forget it" promise: because envoy **skips any `.env` that already exists**, running it on every install is completely safe and idempotent. Contributors who already have a `.env` never have their values touched; everyone else gets a working one for free. You configure it once and never think about onboarding again.

**npm vs Yarn**

Use `postinstall` for this hook regardless of which package manager your project uses. While npm supports a `prepare` lifecycle script that only runs during local development, **Yarn Berry does not support `prepare`** — `postinstall` is the correct choice for both.

**Library authors**

If your package is published to npm, a bare `postinstall` will run for every consumer who installs your package as a dependency — which is not what you want. Use [`pinst`](https://github.com/typicode/pinst) to strip the hook from your published tarball:

```sh
yarn add --dev pinst
```

```json
{
	"scripts": {
		"postinstall": "envoy",
		"prepack": "pinst --disable",
		"postpack": "pinst --enable"
	}
}
```

`pinst --disable` removes `postinstall` from `package.json` before packing, so the published tarball consumers receive contains no hook. `pinst --enable` restores it locally afterward.

## Secrets in, never out

Envoy treats your secrets as a one-way street: they flow **in** from `~/.env` to the projects that need them, and envoy actively stops them flowing **out** into version control. Two complementary gates enforce this — one when envoy writes, one when you commit:

- **At write time**, envoy refuses to populate a `.env` that git is already tracking, so it can never push secrets into a file headed for the repository.
- **At commit time**, `envoy --check` fails the commit if a real secret has leaked into a staged or tracked file.

Together they close the loop: there's no point at which a real value envoy manages can slip into a commit unnoticed.

### Stop leaks before they're committed (`--check`)

`--check` turns envoy into a read-only safety gate. It never writes or modifies any file — it only looks for real secrets that have made their way into files you're about to commit:

```sh
envoy --check
```

When run, envoy:

1. Determines which files to scan — files **staged for commit** if any are staged, otherwise **all tracked files** (so it works both as a git hook and as an ad-hoc audit)
2. Cross-references their contents against the values in your root `~/.env`
3. Reports any file containing a verbatim copy of a known secret and exits non-zero
4. Exits **zero, silently** when nothing is wrong — CI- and pre-commit-friendly

```
⚠ Possible secret detected in .env.example:
  STRIPE_SECRET_KEY contains a value matching your local ~/.env
```

Because it only scans staged or tracked files, anything covered by `.gitignore` (like your real `.env`) is never flagged. To keep false positives low, only **exact, full value matches** count, and obvious placeholders — short values, `<your-key>`, `changeme`, `sk_test_…`, `*_here`, and similar — are ignored.

**Without a `~/.env`**, there are no known values to compare against, so envoy falls back to a lightweight heuristic: it warns when a secret-shaped key (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`) holds a non-placeholder value.

The zero-exit-on-clean contract means it stays invisible until the day it saves you. Wire it into your commit step via your `package.json`:

```json
{
	"scripts": {
		"precommit": "envoy --check"
	}
}
```

…or a git hook manager like [husky](https://github.com/typicode/husky) or [lefthook](https://github.com/evilmartians/lefthook):

```yaml
# lefthook.yml
pre-commit:
    commands:
        check-env:
            run: envoy --check
```

### Refuse to write into tracked files (write-time checks)

Every time envoy writes a `.env` file it runs two git safety checks automatically:

**1. Git tracking check** — if `.env` is already committed to the repository, envoy refuses to overwrite it and exits with a non-zero code:

```
🚨 Blocked /your/project/.env — this file is tracked by git. Remove it from
   version control before proceeding:
   git rm --cached /your/project/.env
```

Writing secrets into a tracked file would put them one `git push` away from exposure. Envoy will not do this under any circumstances without `--skip-audit`.

**2. Gitignore check** — if `.env` is not covered by any `.gitignore` rule, envoy writes the file but prints a warning:

```
⚠️  /your/project/.env is not covered by .gitignore — add it to prevent
    accidentally committing secrets
```

Both checks use git's own plumbing (`git check-ignore` and `git ls-files`) so nested `.gitignore` files, global ignores, and `.git/info/exclude` are all respected. In directories that aren't git repositories the checks are skipped silently.

Use `--skip-audit` to bypass both checks — for example, in a non-git environment where git isn't available:

```sh
envoy --skip-audit
```

## MCP tool

Envoy ships an MCP server so AI tools can call `copy_env` and `check_env` directly. Add it to your host's config:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
	"mcpServers": {
		"envoy": {
			"command": "npx",
			"args": ["-y", "@allons-y/envoy/mcp"]
		}
	}
}
```

**Claude Code** (`.claude/settings.json`):

```json
{
	"mcpServers": {
		"envoy": {
			"command": "npx",
			"args": ["-y", "@allons-y/envoy/mcp"]
		}
	}
}
```

The `copy_env` tool accepts `dir`, `force`, `dry_run`, `root_env_path`, and `skip_audit` — the same options as the CLI. A read-only `check_env` tool is also exposed (accepting `dir` and `root_env_path`), mirroring `envoy --check` for AI-driven pre-commit validation.

## How it works

**Copying values (`envoy`)**

1. Scans `dir` recursively for `.env.example` files (ignoring `node_modules`)
2. For each one, checks whether a `.env` already exists alongside it (skips unless `--force`)
3. Runs git safety checks — blocks if `.env` is tracked; warns if it isn't gitignored
4. Reads `~/.env` (or `--root`) into a key → value map
5. Walks every line in `.env.example`:
    - **Comments and blank lines** are written through unchanged
    - **`KEY=VALUE` lines** where `KEY` exists in `~/.env` get the root value substituted
    - **`KEY=VALUE` lines** where `KEY` is absent fall back to the example value
6. Writes the result to `.env` next to the example file

**Validating commits (`envoy --check`)**

1. Asks git which files are staged — or, if none are, every tracked file
2. Reads `~/.env` (or `--root`) into the set of real values to protect
3. Flags any scanned file containing one of those values verbatim — or, with no `~/.env`, any secret-shaped key holding a non-placeholder value
4. Exits non-zero on a finding, or zero and silent when clean — all without writing anything

No network calls. No config files. No global state.

## What's next

Envoy is intentionally minimal today — it does one thing and does it well. The bigger vision is to make it the single tool that bridges your personal secrets and every project you work in, without friction or foot-guns. That means smarter value handling, better control over what gets scanned and where, and tighter integration with the safety checks developers already rely on.

Follow along or share your ideas in the [roadmap discussion](https://github.com/Allons-y-Studio/envoy/discussions/12).

## Requirements

- Node.js >= 24.0.0

## License

[Apache 2.0](./LICENSE) © [Cassondra Roberts](https://allons-y.llc)

[github-image]: https://github.com/Allons-y-Studio/envoy/actions/workflows/test.yml/badge.svg?branch=main
[github-url]: https://github.com/Allons-y-Studio/envoy/actions/workflows/test.yml
[npm-image]: https://img.shields.io/npm/v/@allons-y/envoy.svg
[npm-url]: https://www.npmjs.com/package/@allons-y/envoy
[coverage-image]: https://img.shields.io/nycrc/Allons-y-Studio/envoy
[coverage-url]: https://github.com/Allons-y-Studio/envoy/blob/main/.nycrc
