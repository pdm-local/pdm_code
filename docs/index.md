---
title: "Introduction"
description: "PDM Code is a terminal coding agent that runs against your own models, locally or through any endpoint you configure"
sidebar_order: 1
---

# PDM Code

A terminal coding agent that runs against your own models. Point it at a local Ollama
server and it never sends a byte off your machine: no cloud account, no API key, no
telemetry.

It also speaks to any OpenAI-compatible endpoint, and to Anthropic and Google directly,
if you would rather mix local and hosted models.

## Why it exists

Every hosted coding agent asks you to send your source to someone else's server. For
work under NDA, under GDPR, or simply under your own judgement, that is not always a
trade you can make. PDM Code is built so that the local path is the good path, not the
degraded one.

## What it is

A CLI coding agent with tool support for file operations, search, and command execution,
running on Linux, macOS and Windows. It is built and configured around a local Ollama
server, and it handles two things that trip up local models specifically:

- **Context sizing.** Ollama serves a model with a small default context window when a
  request does not ask for more, and most agent harnesses do not ask. A coding agent's
  system prompt plus tool schemas run to roughly 26,000 tokens, so the prompt is
  silently truncated, tool definitions arrive half-parsed, and the model answers in
  prose or stalls with no error at all. `--context-max`, a per-provider
  `contextWindow`, `OLLAMA_NUM_CTX`, or a Modelfile with `num_ctx` set each fix it.
  See [the Ollama provider guide](configuration/providers/ollama.md).
- **Tool-calling capability.** Advertising the `tools` capability is not the same as
  emitting a usable tool call. `/tune` trims the prompt and the tool set for models
  that struggle with the full surface, and the conversation loop falls back to parsing
  tool calls out of plain text when a model cannot emit them natively.

## Quick Start

```bash
git clone https://github.com/pdm-local/pdm_code.git
cd pdm_code && pnpm install && pnpm build
pnpm link --global      # exposes `pdm`
pdm
```

See the [Installation Guide](getting-started/installation.md) for the full setup, and
[Configuration](configuration/index.md) for connecting a provider.

## Credits

PDM Code is a fork of [Nanocoder](https://github.com/Nano-Collective/nanocoder) by the
Nano Collective, used under the MIT licence.
