---
title: "Installation"
description: "Build and install PDM Code from source"
sidebar_order: 2
---

# Installation

PDM Code is not published to a package registry. It is built from this repository and
run from the checkout.

## Prerequisites

- **Node.js 22+** on Linux, macOS, or Windows
- **pnpm**, managed via Corepack and pinned by the repo's `packageManager` field.
  Corepack ships with Node 22; if `pnpm` isn't found, run `corepack enable` once.
- A model provider. [Ollama](https://ollama.com) with at least one tool-capable model
  is the default; any OpenAI-compatible endpoint, Anthropic, or Google works too. See
  [Configuration](../configuration/index.md).

## Build

```bash
git clone https://github.com/pdm-local/pdm_code.git
cd pdm_code
pnpm install
pnpm build
```

That produces `dist/cli.js`. Run it directly:

```bash
node dist/cli.js
```

## Running it as `pdm`

Link the checkout so the `pdm` binary is on your `PATH`:

```bash
pnpm link --global
```

Then `pdm` works from any directory. It always runs the build in this checkout, so
re-run `pnpm build` after pulling changes.

## Windows

Everything above works unchanged in PowerShell, `cmd.exe`, and Git Bash. Two notes:

- `pnpm test:all` is a shell script and needs **Git Bash** (or WSL). The individual
  steps (`pnpm test:types`, `pnpm test:lint`, `pnpm test:ava`) run anywhere.
- The `execute_bash` tool runs commands through `cmd.exe` on Windows, so use Windows
  command syntax when you ask the agent to run something directly.

Windows is covered by CI on every commit alongside Linux.

## Nix

`flake.nix` builds the package from source and is self-contained:

```bash
nix build            # from a checkout
```

## Optional: the offline sandbox

A separate, Linux-only launcher can run PDM Code inside a transient systemd scope with
no network egress beyond loopback. It lives in its own repository and is **not required
to use PDM Code**; nothing on this page depends on it.

## Development

```bash
pnpm run dev         # tsc --watch
pnpm test:ava        # the test suite
pnpm test:all        # format, types, lint, tests, knip, audit (needs a POSIX shell)
```
