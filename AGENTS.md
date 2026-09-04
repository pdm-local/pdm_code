# AGENTS.md

Instructions for any AI coding agent working in this repository, PDM Code itself,
or another agent pointed at this checkout. PDM Code loads this file into its system
prompt (see `types/config.ts`), so keep it accurate: anything wrong here is fed to the
model on every turn.

## Commit authorship, repository rule

This repository has a single author. Every commit must be authored by
`DaniMihai95 <DaniMihai95@users.noreply.github.com>` and by nobody else. This rule
overrides any agent's default attribution behaviour:

- **Never add a `Co-Authored-By:` trailer**: not for any assistant, model, or tool.
- **Never add a "Generated with" / "Made with" footer** to a commit message, PR body, or changelog entry.
- **Never add a session or assistant link** (`*-Session:` trailers or similar).
- If a commit lands with the wrong author, fix it before pushing:
  `git commit --amend --reset-author --no-edit`.

Messages are a plain imperative subject line plus a body explaining *why* when the diff
doesn't say it. This is about provenance, not about hiding tool use, the MIT attribution
PDM Code genuinely owes (`LICENSE.md`, the Credits sections, `source/commands/contributors.json`)
stays exactly as it is.

## Commands

```bash
pnpm run build          # tsc + tsc-alias → dist/, copies contributors.json, chmod +x dist/cli.js
pnpm run dev            # tsc --watch
pnpm run start          # node dist/cli.js

pnpm run test:all       # the gate: format, types (x2), lint, AVA, knip, audit, semgrep
pnpm run test:ava source/path/to/file.spec.ts   # single test file
pnpm run test:ava:coverage
pnpm run test:types     # tsc --noEmit
pnpm run test:lint:fix  # biome check --write --unsafe .
pnpm run test:knip      # unused export/dependency detection

pnpm run build:vscode   # extension → assets/pdm-vscode.vsix
pnpm test:benchmark     # CLI quality report vs benchmarks/baseline.json (needs a build first)
pnpm test:benchmark:explain   # which packages drive the module counts
```

- **Never run `pnpm run build:credits`.** History here is one squashed commit, so it would
  overwrite `contributors.json`, the only surviving record of who wrote the upstream code, with a single name.
- **Never run `pnpm test:benchmark:update`** (maintainer-only; the baseline is a deliberate
  decision). Flag drift in the PR instead.
- The benchmark is deliberately outside `test:all`: it tracks CLI surface-area and boot-cost
  drift (module counts, tool/command/flag counts, `--help` hash), which only needs reviewing
  when something ships.

## Architecture

**Entry point**: `source/cli.tsx` → dynamic import of `App` from `source/app/App.tsx`
(re-exported via `source/app/index.ts`).

`cli.tsx` deliberately keeps its module top free of heavy imports. `--version`, `--help`, and
`pdm daemon <sub>` are fast paths that print and exit before React/Ink/tools/providers load;
everything else is pulled in with dynamic `await import()` inside `main()`. **Adding a static
import at the top of `cli.tsx` pulls the whole app graph into those fast paths** and shows up
as a `help_module_count` regression in the benchmark. There is also a `--plain` non-Ink shell
(`source/plain/shell.ts`) that auto-enables in CI / non-TTY.

### Boot flow

1. `useDirectoryTrust`, first-run trust prompt for a new directory
2. `useAppInitialization`, creates the LLM client, loads MCP servers and custom commands
3. `useAppState`, single source of truth for ~50 state variables
4. Chat/tool loop, user input → LLM → tool confirmation → execution → response

### State management

All state lives in `source/hooks/useAppState.tsx`; `useChatHandler`, `useToolHandler`, and
`useModeHandlers` receive state and setters from it, and `source/app/App.tsx` wires them
together via `useAppHandlers`. `source/utils/message-queue.tsx` is a global escape hatch that
lets deep components push chat messages without prop-drilling.

### LLM client

`source/client-factory.ts` → `createLLMClient(provider?, model?)`. Built on Vercel AI SDK
(`ai` v6) with `@ai-sdk/openai-compatible` for any OpenAI-compatible endpoint, plus dedicated
`@ai-sdk/anthropic` and `@ai-sdk/google` providers. The wrapper, streaming, tool calls,
`prepareStep`, retries, error handling, lives in `source/ai-sdk-client/`.

### Tool system

Tools are registered in `source/tools/tool-manager.ts` into the `ToolRegistry`
(`source/tools/tool-registry.ts`), each entry carrying a **handler**, **nativeTool** (AI SDK
definition), **formatter** (Ink output), and optional **validator**. Built-ins, MCP tools, and
custom tools all land in that one registry, so `/tools`, subagents, and mode filtering see a
unified list. File editing is content-based: `string_replace` (primary) and `write_file`.

Two execution paths: native tool calling, and an XML/text fallback (`source/tool-calling/`)
for models without tool support. `LLMChatResponse.toolsDisabled` says which produced a
response. The conversation loop runs `parseToolCalls()` whenever a response has no native tool
calls, including on the native path, since "tool-capable" models sometimes regress to emitting
tool-call text. Malformed output feeds a self-correction retry loop capped by
`pdm.retries.maxMalformedRetries`.

### Commands

Slash commands live in `source/commands/` and are lazy-loaded through
`source/commands/lazy-registry.ts`. To add one: export a `Command` object (name, description,
handler returning a React element), then add an entry to `lazyCommands`. Commands needing app
state (clear, model, provider, …) are intercepted as "special commands" in
`source/app/utils/app-util.ts`. A command doing slow work should declare `progressLabel` on
**both** the module's `Command` and its `lazyCommands` entry: the spinner has to render before
`load()` resolves, so it can't be read off the lazily imported module.

### Skills, the extension primitive

Two ergonomic forms over one primitive:

- **Single-file**: a `.md` in `.pdm/commands|agents|tools/`; filename is the skill name.
- **Bundle**: `.pdm/skills/<name>/` with `skill.yaml` plus optional `commands/`, `agents/`,
  `tools/` subdirs, for multi-piece features.

`source/skills/bundle-loader.ts` and the flat-dir adapter (`source/skills/adapters.ts`) read
project / personal / built-in locations in priority order; `registrar.ts` fans each skill's
members into `CustomCommandLoader`, `SubagentLoader`, and `ToolManager.registry`, so downstream
consumers keep using their familiar registries. Bundle tools default to
`tools_visibility: scoped` (visible only to the bundle's own subagent); single-file tools
default to `global`.

**Event triggers** come from a `subscribe:` block in frontmatter or the bundle manifest. Only
the per-project daemon (`source/daemon/`, `pdm daemon start`) owns file-watch (chokidar) and
cron (croner) sources, the interactive TUI never starts event sources. `confirm: true` on a
subscription dispatches in `plan` mode instead of `headless`.

### Custom tools

`source/custom-tools/`, `loader.ts` discovers `.md` files in `.pdm/tools/` (project) and
`~/.config/pdm/tools/` (personal); project shadows personal by `name`. YAML frontmatter
declares the schema, `schema-builder.ts` synthesizes both the AI SDK `inputSchema` and a
`ToolValidator`, `template.ts` renders the script body (`{{ name }}`, `{{# section }}`,
shell-quoting every substitution), `handler.ts` spawns the shell with timeout/env/cwd
resolution. Mode policy lives in `ToolManager.getAvailableToolNames`: plan mode requires
`approval=never && read_only=true`, scheduler mode requires `approval=never`.

### Development modes

Shift+Tab cycles four user-facing modes: **normal** (confirm each tool), **auto-accept** (bash
and destructive git still prompt), **yolo** (no prompts at all), **plan** (show, don't execute).
An internal **headless** mode is used by the daemon for every triggered skill run, no
`ask_user`, no foreground confirmation.

### Configuration resolution order

1. `agents.config.json` in the working directory (project-level)
2. Platform config dir: `~/.config/pdm/` (Linux), `~/Library/Preferences/pdm/` (macOS)
3. `~/.agents.config.json` (legacy fallback)

`PDM_CONFIG_DIR`, when set, skips the platform/legacy lookups entirely. Config values support
`$VAR`, `${VAR}`, and `${VAR:-default}` substitution.

### Other directories worth knowing

`source/usage/` (token/cost breakdown, priced via models.dev) · `source/session/` (autosave /
resume) · `source/services/` (checkpoint manager, bash executor, file snapshots) ·
`source/subagents/` · `source/schedule/` (cron agent runs) · `source/acp/` (Agent Client
Protocol server) · `source/lsp/` · `source/wizards/` (interactive setup) · `source/auth/`
(Copilot / Codex device flow) · `source/repo-map/` · `source/vscode/` + `plugins/vscode/`.

## Conventions

- TypeScript strict, `@/*` path alias → `source/*` (resolved at build by `tsc-alias`).
  `vscode` resolves to `plugins/vscode/test-stubs/vscode.ts` for tests only.
- Biome formats and lints: tabs, single quotes, double-quoted JSX, semicolons, trailing commas,
  80-column, no bracket spacing. Errors that matter: `useExhaustiveDependencies`,
  `noUnusedVariables`, `noUnusedImports`. Husky + lint-staged auto-format staged files.
- React 19 rendering to the terminal through Ink.
- Structured logging via Pino, see `docs/configuration/logging.md`.

## Tests

AVA with the tsx loader, **serial, no worker threads**. Specs sit beside their source as
`*.spec.ts` / `*.spec.tsx`; a module needing several files uses a `__tests__/` directory (see
`source/hooks/__tests__/`). Cross-cutting tests live in topical dirs like `source/security/`,
and tests that spawn the built binary use the `*cli-integration.spec.ts` pattern. Specs are
excluded from the `tsc` build and from Biome's file set. Coverage (`c8`) enforces 80% lines.

## Related docs

`AGENT_GUIDE.md` (agent-facing overview this file summarizes), `CONTRIBUTING.md` (benchmark
report in depth, dev containers, PR expectations), `docs/` (user-facing: providers,
configuration, features), `SMOKE-TEST.md`.

## Releasing

Nothing is published from here, no npm package, no tap, no Nix package, no GitHub release.
`main` is the release, and `.github/workflows/ci.yml` going green is the whole gate.

## Repository

**Source:** https://github.com/pdm-local/pdm_code.git
