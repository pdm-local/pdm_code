# Contributing to PDM Code

Thank you for your interest in contributing to PDM Code! We welcome contributions from developers of all skill levels. This guide will help you get started with contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Coding Standards](#coding-standards)
- [Releasing](#releasing)

## Getting Started

Before contributing, please:

1. Read our [README](README.md) to understand what PDM Code does
2. Check our [issue tracker](https://github.com/pdm-local/pdm_code/issues) for existing issues

## How to Contribute

### Finding Work

Browse our open issues. If you find an unassigned issue you'd like to work on, comment on it to let us know you're picking it up.

### Working on an Issue

1. **Check for a spec** - Some issues include a specification or implementation details. Feel free to follow it or propose alternatives if you think you have a better approach.

2. **No spec? Write one** - If the issue lacks a spec, draft one and post it in the issue comments for discussion before starting work.

3. **Submit a PR** - When ready, open a pull request referencing the issue. We'll review it and work with you to get it merged.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm (managed via Corepack, see below)
- Git

> **pnpm version is pinned via Corepack.** The repo's `package.json` declares `"packageManager": "pnpm@11.x.x"`, and Node 22 ships [Corepack](https://nodejs.org/api/corepack.html) which auto-uses that exact pnpm version when you run `pnpm` inside the repo, no manual install needed. If you see `Corepack must be enabled`, run `corepack enable` once. To bump pnpm for the project, run `corepack use pnpm@latest` (this rewrites the `packageManager` field; CI follows automatically).

### Setup Steps

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/YOUR-USERNAME/pdm.git
   cd pdm
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Build the project:**

   ```bash
   pnpm run build
   ```

4. **Test your setup:**

   ```bash
   pnpm run start
   ```

### Using Dev Containers (Recommended)

For a zero-setup, consistent development environment, we recommend using VS Code Dev Containers. This approach eliminates the need to install Node.js, pnpm, or other tools on your local machine.

#### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

#### Quick Start

1. **Clone the repository** (if not already done)
   ```bash
   git clone https://github.com/YOUR-USERNAME/pdm.git
   cd pdm
   ```

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Reopen in Container**
   - When VS Code prompts "Reopen in Container", click **"Reopen in Container"**
   - Or press `F1` and select `Dev Containers: Reopen in Container`

4. **Wait for Automatic Setup**
   - The container builds on first use (~2-3 minutes)
   - Dependencies install automatically
   - The project builds automatically
   - Git hooks are configured automatically

5. **Start Development**
   ```bash
   pnpm run dev  # Development mode with hot reload
   pnpm test:all # Run all tests
   pnpm run start # Start the application
   ```

#### What's Included

The devcontainer comes pre-configured with:

- **Node.js 22.x** - Pre-installed and ready
- **pnpm latest** - Package manager with cached store
- **Biome** - Formatter and linter (auto-formats on save)
- **Zsh + Oh My Zsh** - Enhanced shell experience
- **VS Code Extensions** - Biome, TypeScript, GitLens pre-installed
- **Git Hooks** - Husky pre-commit hooks configured automatically
- **Network Access** - Full connectivity for MCP server testing

#### Benefits

- **Zero Setup** - All tools pre-installed in container
- **Consistent Environment** - Same tools and versions for all developers
- **Isolated Development** - No conflicts with local tools
- **Fast Setup** - Automated dependency installation
- **Easy Cleanup** - Delete container to remove everything

#### For More Information

See [`.devcontainer/README.md`](.devcontainer/README.md) for:
- Troubleshooting steps
- Advanced configuration options
- Git credential setup
- Performance optimization tips

### Recommended Editor Setup

For the best development experience, we recommend using VS Code with the **Biome extension** for automatic formatting and linting:

1. **Install Biome VS Code Extension:**
   - Open VS Code and go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
   - Search for "Biome" and install the official extension: [biomejs.dev/reference/vscode](https://biomejs.dev/reference/vscode/)
   - Or install from the command line:
   ```bash
   code --install-extension biomejs.biome
   ```

2. **Configure VS Code settings** (optional, for format on save):
   Add to your `.vscode/settings.json`:
   ```json
   {
     "editor.defaultFormatter": "biomejs.biome",
     "editor.formatOnSave": true,
     "editor.codeActionsOnSave": {
       "quickfix.biome": "explicit",
       "source.organizeImports.biome": "explicit"
     }
   }
   ```

### Migrating from Prettier

If you previously had Prettier configured in your development environment:

1. **Uninstall/disable the Prettier VS Code extension** to avoid conflicts
2. **Remove any local Prettier configuration** files (`.prettierrc`, `.prettierrc.json`, etc.)
3. **Install the Biome extension** (see instructions above)
4. **Run `pnpm format`** to reformat your working changes with Biome

### Pre-commit Hooks

This project uses **husky** and **lint-staged** to automatically format staged files before each commit. After running `pnpm install`, the pre-commit hook will be set up automatically.

**What happens on commit:**
- Staged `.js`, `.ts`, `.jsx`, `.tsx`, `.json`, and `.md` files are automatically formatted with Biome
- If formatting fails, the commit will be blocked until issues are resolved

**To skip the pre-commit hook** (not recommended):
```bash
git commit --no-verify -m "your message"
```

## Testing

### Automated Testing Requirements

All new features and bug fixes should include appropriate tests:

1. **Test Suite**: We use AVA for testing with TypeScript support
2. **Test Files**: Place test files alongside source code with `.spec.ts` extension (e.g., `source/utils/parser.spec.ts`). Cross-cutting tests that don't have a single source file (e.g., security tests covering multiple modules) live in topical directories like `source/security/`. Integration tests that spawn the CLI binary use the `cli-integration.spec.ts` naming pattern.
3. **Running Tests**: Execute the full test suite with:

   ```bash
   pnpm test:all
   ```

   This command runs: Biome formatting checks, type checks, lint checks, AVA tests, Knip, security scans.

4. **Test Requirements for PRs**:
   - New features **must** include passing tests in `.spec.ts/tsx` files
   - Bug fixes should include regression tests when possible
   - All tests must pass before merging (`pnpm test:all` should complete successfully)
   - Tests should cover both success cases and error scenarios

### Manual Testing

In addition to automated tests, manual testing is important for CLI interactions:

1. **Test different AI providers:**

   - Ollama (local)
   - OpenRouter (API)
   - OpenAI-compatible endpoints

2. **Test core functionality:**

   - File operations (read, write, edit)
   - Bash command execution
   - Custom commands
   - MCP server integration

3. **Test error scenarios:**
   - Network failures
   - Invalid configurations
   - Missing dependencies

### Quality report and benchmarks

The **CLI quality report** measures the built binary (`dist/cli.js`) across four categories (correctness, performance, stability, and health) and compares the numbers against a baseline checked into `benchmarks/baseline.json`. It exists to catch regressions that `test:all` can't see, like a tool disappearing from the registry, `--help` text changing unintentionally, or the startup module graph ballooning.

**When it runs:** never automatically. It is intentionally **not** wired into `pnpm test:all` or CI: the metrics it tracks are surface-area and boot-cost drift, which only need reviewing when something meaningful ships. Run it by hand when you want a drift check.

You can still run it locally any time you want a drift check:

```bash
pnpm run build                  # benchmark reads dist/, so build first
pnpm test:benchmark              # run the report, compare against baseline
pnpm test:benchmark:update       # MAINTAINERS ONLY, overwrite benchmarks/baseline.json
pnpm test:benchmark:explain      # diagnostic: show which packages contribute to the module count
```

The `:explain` mode is the tool to reach for when `help_module_count` or `interactive_module_count` jumped and you want to know *which* package is responsible. It runs the CLI under a diagnostic ESM loader, captures every resolved module URL, and groups them by top-level package. Output lives at `benchmarks/explain.json` for programmatic inspection.

> **Note for contributors:** `pnpm test:benchmark` is fine to run anytime; it's read-only and useful for sanity-checking your own changes. But **`pnpm test:benchmark:update` is reserved for codeowners/maintainers**. The baseline is the shared source of truth for "what is normal", and updating it is a deliberate decision that belongs in the release flow. If your PR surfaces a drift (e.g. you added a tool and `tool_count` is now off), don't update the baseline yourself. Flag it in the PR description and a maintainer will update the baseline as part of cutting the next release.

The report writes a machine-readable copy to `benchmarks/report.json` so agents can parse results programmatically.

#### Reading the output

Every metric is compared against the baseline checked into `benchmarks/baseline.json` and assigned one of three statuses:

- **OK**: within tolerance of baseline
- **WARN**: drifted beyond tolerance but not catastrophic (e.g. module count +25% or a stability count dropped)
- **FAIL**: hard threshold breached (e.g. module count doubled, or an exact-value correctness check diverged). A FAIL exits non-zero and blocks the release workflow.

The four categories answer:

- **Correctness**: exit codes and error routing behave as expected
- **Performance**: module-resolution count for `--help`, `--version`, and full interactive boot (deterministic startup proxies) and `dist/` size
- **Stability**: CLI flag count, tool count, command count, and a hash of `--help` text (detects unintentional surface area drift)
- **Health**: test file / test case counts, high-severity audit vulnerability count

> **Why module count instead of wall-clock time?** Wall-clock startup timing is flaky on shared CI runners and varies across machines, so the report measures the number of modules Node resolves while booting the CLI instead. That number is identical on every run and every machine, so a jump from 4603 to 5100 is unambiguous signal that a new import path was added.

The report measures three boot paths:

- **`help_module_count`** / **`version_module_count`**, modules resolved when running `node dist/cli.js --help` / `--version`. Measured via `execFileSync`.
- **`interactive_module_count`**: modules resolved when booting the CLI in interactive mode (no args). The runner spawns the CLI under the counting loader, polls the count file every 100ms, waits until it has been stable for 1.5s (i.e. steady state), then sends SIGTERM. Deterministic because we wait for stability, not a fixed wall-clock window.

Comparing `help_module_count` and `interactive_module_count` is also a useful signal on its own: if they're nearly identical (as they are today), the CLI has no fast path for flag parsing and is paying the full boot cost just to print help text.

#### Adding new metrics

1. Add the measurement to `benchmarks/measure.ts`. There are four `MetricGroup`s (`correctness`, `performance`, `stability`, `health`). Pick the right group and add a new entry.
2. Numeric metrics default to `warnRatio: 1.25` and `failRatio: 2.0`. Tighten these later once the baseline has stabilized.
3. Set `warnOnDecrease: true` for count-style metrics where a drop signals accidental deletion (tool count, test count, etc.).
4. Open a PR with the new metric. A maintainer will run `pnpm test:benchmark:update` to record it in the baseline as part of the merge or the next release; contributors should not update `benchmarks/baseline.json` themselves.
5. `benchmarks/report.ts` picks new metrics up automatically; no changes are required there.

#### Troubleshooting

- **`dist/cli.js not found`** → Run `pnpm run build` before `pnpm test:benchmark`. The benchmark reads the compiled binary directly and doesn't trigger a build itself.
- **`help_module_count` or `interactive_module_count` jumped** → A new import path was pulled into the startup graph. Check the diff for new imports in `source/cli.tsx` or its transitive dependencies. If the jump is intentional (you deliberately added a dependency), update the baseline.
- **`interactive_module_count` hit the 20s hard timeout** → Something in interactive boot is continuously resolving modules (never reaching steady state) or the app is hanging on I/O before startup completes. Run `node dist/cli.js` manually and see what it's doing.
- **`audit_high_vulns` increased** → Check whether it's a new vulnerability or the known pre-existing `minimatch` transitive dep from AVA. Investigate before updating the baseline.
- **`help_hash` changed unexpectedly** → Something altered `--help` output. Compare against the previous build to confirm it's intentional.

### Writing Tests

When adding tests:

- Use descriptive test names that explain what is being tested
- Follow the existing test patterns in the codebase
- Test edge cases and error conditions
- Keep tests focused and isolated
- Mock external dependencies (APIs, file system) when appropriate

**Test File Organization**:

For simple cases, place test files alongside the source code:

```
source/utils/parser.ts
source/utils/parser.spec.ts
```

For complex testing scenarios requiring multiple test files or shared test utilities, use a `__tests__` directory:

```
source/hooks/useInputState.ts
source/hooks/__tests__/
  ├── test-helpers.ts
  ├── useInputState.deletion.spec.ts
  ├── useInputState.state-management.spec.ts
  └── useInputState.undo-redo.spec.ts
```

This pattern is useful when:

- A single module requires multiple test files organized by category or feature
- Tests need shared fixtures, mocks, or helper functions
- Test complexity benefits from separation of concerns

See `source/hooks/__tests__/` for examples of this pattern in practice.

## Coding Standards

### TypeScript Guidelines

- **Strict Mode**: The project uses strict TypeScript settings
- **Types First**: Always define proper TypeScript types
- **No `any`**: Avoid using `any` type; use proper type definitions
- **ESNext**: Use modern JavaScript/TypeScript features

### Code Style

- **Formatting**: Code is auto-formatted (maintain existing style)
- **Naming**: Use descriptive variable and function names
- **Comments**: Add comments for complex logic, not obvious code
- **Error Handling**: Always handle errors gracefully

### Logging

PDM Code uses structured logging based on Pino. See [`docs/pino-logging.md`](docs/pino-logging.md) for details.

## Development Tips

### Working with AI Providers

- Test with multiple providers to ensure compatibility
- Handle API failures gracefully
- Respect rate limits and API quotas

### Tool Development

- New tools should implement the common tool interface
- Always validate inputs and handle errors
- Document tool capabilities clearly

### MCP Integration

- Follow MCP protocol specifications
- Test with real MCP servers
- Handle connection failures properly

### UI/UX Considerations

- Maintain consistent CLI interface
- Provide clear feedback to users
- Handle long-running operations gracefully

## Releasing

There is no release process. This repository publishes nothing: no npm
package, no Homebrew tap, no Nix package, no GitHub release. `main` is the release.

`.github/workflows/ci.yml` builds and runs the test suite on every push and pull
request; that check going green is the whole gate.

Changesets tooling is still wired up (`pnpm changeset`, `pnpm changeset:version`) if you
ever want a generated `CHANGELOG.md` entry, but nothing runs it automatically.

Before pushing anything substantial, run the full local gate from a clean tree:

```bash
pnpm run test:all      # formatter / typecheck / lint / AVA / knip / audit / semgrep
pnpm run build         # the benchmark reads dist/, so build first
pnpm test:benchmark    # CLI quality report, compared against benchmarks/baseline.json
```

The benchmark is deliberately not part of `test:all`, it tracks surface-area and
boot-cost drift, which only needs reviewing when something ships. If it flags drift you
believe is intentional, run `pnpm test:benchmark:update` and commit the new baseline so
the change is visible in the diff. Any FAIL means a correctness regression: fix it.

---

Thank you for contributing to PDM Code.
