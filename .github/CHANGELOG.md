# Changelog

All notable changes to this project will be documented in this file. See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.1.0](https://github.com/castastrophe/envoy/compare/v1.0.0...v1.1.0) (2026-03-26)

### ✨ Features

- add git safety checks when writing .env files ([5407f2c](https://github.com/castastrophe/envoy/commit/5407f2c2bb3bc2593e3de6c90cb7c8888c8f19ed))

Envoy now guards against one of the most common causes of secret leaks:
accidentally committing a .env file. If the target .env is already
tracked by git, envoy refuses to write it and exits non-zero — keeping
secrets off the wire no matter what. If the file isn't covered by any
.gitignore rule, envoy writes it but fires a loud warning so developers
can fix the gap before it becomes an incident.

Both checks use git's own plumbing (check-ignore, ls-files) so nested
gitignores, global ignores, and .git/info/exclude are all respected.
Use --skip-audit / skip_audit to opt out in non-git environments.

## [1.0.0](https://github.com/castastrophe/envoy/releases/tag/v1.0.0) (2026-03-26)

### ✨ Features

- initial release of `@allons-y/envoy` ([3f2779d](https://github.com/castastrophe/envoy/commit/3f2779db831ad97f1dd07a636d329a531c499f92))

CLI and MCP tool that copies values from a root .env into project .env
files using .env.example as a template. Includes ESM library, CLI
binary, MCP server, tests, and full project scaffolding.

- **mcp:** export `copyEnvToolHandler` for direct unit testing ([1182b5f](https://github.com/castastrophe/envoy/commit/1182b5f903d0a659f86f697e5921d9a86028693f))

Extract the copy_env tool callback into a named export so it can be
tested directly without spawning an MCP transport. Add five unit tests
covering MCP response structure, dry-run, value substitution, and the
empty-directory case.
