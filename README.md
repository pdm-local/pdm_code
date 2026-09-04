# PDM Code

A terminal coding agent that runs against your own models. Point it at a local Ollama
server and it never sends a byte off your machine: no cloud account, no API key, no
telemetry.

It also speaks to any OpenAI-compatible endpoint, and to Anthropic and Google directly,
if you would rather mix local and hosted models.

```bash
pdm                                  # interactive, in the current directory
pdm --provider ollama --model qwen3-coder:30b
pdm run "add tests for the auth module"     # non-interactive
```

Linux, macOS and Windows. Node.js 22 or newer.

---

## Why it exists

Every hosted coding agent asks you to send your source to someone else's server. For
work under NDA, under GDPR, or simply under your own judgement, that is not always a
trade you can make. PDM Code is built so that the local path is the good path, not the
degraded one: the tool system, the context management, and the terminal UI are the same
whether the model is running on your GPU or in a datacentre.

## Install

There is no package registry release. Build it from source:

```bash
git clone https://github.com/pdm-local/pdm_code.git
cd pdm_code
pnpm install
pnpm build
```

`pnpm` comes with Node 22 through Corepack. If it isn't found, run `corepack enable`
once.

That produces `dist/cli.js`. To get a `pdm` command on your `PATH`:

```bash
pnpm link --global
```

Or skip that and run `node dist/cli.js` directly. Either way, re-run `pnpm build` after
pulling changes, because both run the build in this checkout.

On Windows this works unchanged in PowerShell, `cmd.exe` and Git Bash. Windows and
Linux are both covered by CI on every commit.

## Connecting it to your own Ollama

Install [Ollama](https://ollama.com) and pull a model that can call tools:

```bash
ollama pull qwen3-coder:30b
```

Then create `agents.config.json` in your project directory:

```json
{
  "providers": [
    {
      "name": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "models": ["qwen3-coder:30b"]
    }
  ]
}
```

No API key: Ollama's OpenAI-compatible endpoint does not want one. Run `pdm` in that
directory and it will use the provider. `/model` opens a picker spanning every
configured provider, so it switches model and provider together;
`/settings providers` is the full editor.

If you would rather not keep a config file per project, put the same file in your user
config directory and every project picks it up:

| Platform | Location |
|---|---|
| Linux | `~/.config/pdm/agents.config.json` |
| macOS | `~/Library/Preferences/pdm/agents.config.json` |
| Windows | `%APPDATA%\pdm\agents.config.json` |

Both files are read and their providers merged by name, with the working directory
winning when the two define the same provider, so a project can override one entry
without restating the rest. Setting `PDM_CONFIG_DIR` replaces the user location.
Values support `$VAR`, `${VAR}` and `${VAR:-default}`, so an API key for a hosted
provider can live in the environment rather than in the file.

### The context-window trap, which will bite you

**Ollama serves a model with a 2048-token context window when the request does not ask
for more**, and most agent harnesses do not ask. A coding agent's system prompt plus its
tool schemas run to roughly 26,000 tokens. The result is not an error: the prompt is
silently truncated, tool definitions arrive half-parsed, and the model answers in prose
instead of calling tools, or stalls with no explanation at all.

If tool calling seems broken, this is almost always why. Three ways to fix it, in
increasing order of permanence:

```bash
# 1. Tell PDM Code the real limit for this run
pdm --context-max 32k

# 2. Raise Ollama's default for the whole server
OLLAMA_NUM_CTX=32768 ollama serve
```

```dockerfile
# 3. Bake it into a derivative model, so it is right no matter who asks
FROM qwen3-coder:30b
PARAMETER num_ctx 32768
```

```bash
ollama create qwen3-coder:30b-32k -f ./Modelfile
```

Option 3 is the one that survives everything, and it costs nothing on disk: Ollama's
layers are content-addressed, so a derivative is a manifest.

You can also set `contextWindow` per provider or `contextWindows` per model in
`agents.config.json`. See
[docs/configuration/providers/ollama.md](docs/configuration/providers/ollama.md).

### Other providers

Any OpenAI-compatible endpoint works with the same block, plus an `apiKey`. Anthropic
and Google have dedicated SDK providers, selected with `"sdkProvider"`. The full set,
with a worked example for each, is in
[docs/configuration/providers/](docs/configuration/providers/index.md).

## Using it

Start `pdm` in a project and talk to it in plain language. Beyond that:

- `@` tags a file into the conversation, `!` runs a shell command directly.
- **Shift+Tab** cycles the four modes: **normal** (confirm every tool),
  **auto-accept** (bash and destructive git still ask), **yolo** (never ask), and
  **plan** (show the tool calls, execute nothing).
- **Ctrl+C** quits, **Esc** interrupts the model mid-answer.

Commands worth knowing on day one:

| Command | What it does |
|---|---|
| `/help` | every command |
| `/init` | analyse the project and write an `AGENTS.md` the agent reads each session |
| `/model` | switch model, across all configured providers |
| `/settings` | providers, MCP servers and preferences, in a UI |
| `/status` | context usage, current model, active settings |
| `/tune` | shrink the prompt and tool set for smaller models |
| `/resume` | reopen an earlier session |
| `/vision-model` | pick a model to describe images (see below) |

The full command reference is [docs/features/commands.md](docs/features/commands.md).

### Flags

`--provider`, `--model`, `--context-max`, `--mode`, `--trust-directory`, `--continue` /
`-c`, `--resume` / `-r`, `--plain`, `--alt-screen`, `--json`, `--output-format`,
`--acp`, `--vscode`, `--version`, `--help`. `pdm run "<prompt>"` is the non-interactive
form, and `--plain` turns off the Ink UI for CI. Each is documented in
[docs/getting-started/index.md](docs/getting-started/index.md).

### Images and large documents

Local coding models usually cannot see. `/vision-model <provider> <model>` nominates a
second, vision-capable model as a delegate: paste an image, and if the coding model
cannot accept it, the delegate transcribes it and the coding model receives the text.
PDM Code asks your Ollama server what each model can actually do rather than guessing
from its name, and when it cannot tell, it passes the image through untouched instead of
rerouting.

For long PDFs, DOCX files and specs, the `search_document` tool retrieves the relevant
passages by keyword rather than loading the whole file into context. No embedding model,
no index files, no GPU time.

## Extending it

Custom commands, subagents and tools are all Markdown files under `.pdm/` in your
project, or `~/.config/pdm/` for personal ones. MCP servers plug in through the same
config file. See [docs/features/](docs/features/index.md).

## Optional: the offline sandbox

A separate, Linux-only launcher can run PDM Code inside a transient systemd scope with
no network egress beyond loopback, no root, and a read-only `$HOME`. It lives in its own
repository and is **not required**: nothing on this page depends on it, and PDM Code
does not make outbound requests on its own regardless.

## Development

```bash
pnpm run dev       # tsc --watch
pnpm test:ava      # the test suite
pnpm test:all      # format, types, lint, tests, knip, audit (needs a POSIX shell)
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the benchmark report and PR expectations;
[AGENTS.md](AGENTS.md) is the architecture overview, written for an agent working in
this repository but just as readable by a person.

## Credits

PDM Code is a fork of [Nanocoder](https://github.com/Nano-Collective/nanocoder) by the
Nano Collective, used under the MIT licence. Their work is the foundation of everything
here concerning the agent loop, the tool system, and the terminal UI. `/credits` in the
app lists the upstream contributors by name.

If you want the upstream project, community-governed, provider-agnostic and excellent,
go and use it directly. It deserves the attention.

## Licence

MIT. See [LICENSE.md](LICENSE.md), which retains the original Nano Collective copyright
as the licence requires.
