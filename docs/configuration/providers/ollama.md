---
title: "Ollama"
description: "Configure Ollama as a local AI provider for PDM Code"
sidebar_order: 1
---

# Ollama

[Ollama](https://ollama.com) is a popular tool for running large language models locally. It provides an OpenAI-compatible API out of the box.

## Configuration

```json
{
	"name": "Ollama",
	"baseUrl": "http://localhost:11434/v1",
	"models": ["your-model-name"]
}
```

No API key is required for local use.

## Setup

1. [Install Ollama](https://ollama.com/download)
2. Pull a model: `ollama pull your-model-name`
3. Ollama starts automatically and serves on port `11434`

## Using a shared server on another device

One machine usually has the GPU. PDM Code runs on each of your devices and talks
to that one server, so your files and tool calls stay local and only prompts and
generated tokens cross the network.

On the machine with the models, tell Ollama to listen on the network interface
rather than loopback. **Bind the private address, not `0.0.0.0`**: Ollama has no
authentication, so `0.0.0.0` serves every machine that can reach the port,
including everything else on your local network. A private mesh VPN such as
Tailscale is the right way to reach it, because it authenticates and encrypts at
the network layer, which is the only thing standing in for the auth Ollama lacks.

Linux:

```bash
sudo systemctl edit ollama
```

```
[Service]
Environment="OLLAMA_HOST=YOUR-PRIVATE-ADDRESS:11434"
```

```bash
sudo systemctl restart ollama
```

Windows, then sign out and back in:

```powershell
setx OLLAMA_HOST YOUR-PRIVATE-ADDRESS:11434
```

macOS:

```bash
launchctl setenv OLLAMA_HOST YOUR-PRIVATE-ADDRESS:11434
```

Then on the other devices, point a provider at it:

```json
{
	"name": "Ollama",
	"baseUrl": "http://YOUR-PRIVATE-ADDRESS:11434/v1",
	"models": ["your-model-name"]
}
```

You do not normally have to write this by hand. When PDM Code starts with no
configuration and finds other devices on the same private network, it asks which
one runs the server, checks it, and writes the file for you. If the check fails
because Ollama is still bound to loopback, it prints the exact command above for
that device's operating system.

### If the connection times out rather than being refused

A refused connection means Ollama is up but bound to loopback. A **timeout**
means the packets are being dropped, and a firewall is the usual reason: a
dropped packet times out where a closed port would be refused, so a correctly
configured Ollama behind a firewall looks identical to a sleeping machine.

On Linux with ufw, allow the port on the private interface only:

```bash
sudo ufw allow in on tailscale0 to any port 11434 proto tcp
```

Scoping the rule to that interface is the point. Combined with
`OLLAMA_HOST=0.0.0.0`, it keeps `localhost` working for the agent running on
that same machine while leaving the port closed to your local network, which
matters because Ollama has no authentication.

### Context length on a shared server

A model is served with whatever `num_ctx` is baked into it on **that** machine,
which need not match your local copies. The setup step reads the real value per
model and records it as `contextWindows`, so the agent budgets against what the
server will actually honour rather than truncating silently. When the server does
not report a value, the field is left out rather than guessed.

## Context Length

By default, Ollama uses a 2048 token context window which is too small for agentic coding. Set the context length as high as your system's memory can handle. Larger context means the model can track more of the conversation history, tool calls, and file contents.

```bash
OLLAMA_NUM_CTX=32768 ollama serve
```

Or set it permanently in your environment.

### Signs of an Insufficient Context Limit

If your context limit is too low, you may notice:

- **Model refuses or fails to use tools**: The model can't include tool definitions and conversation history in its limited context, making tool calling unreliable or broken.
- **Poor memory and reasoning**: The model loses track of recent conversation, forgets what it was working on, or contradicts earlier decisions.
- **Repetitive or looping responses**: The model repeats the same suggestions or asks the same questions because it can't see what it already said.
- **Responses cut off mid-sentence**: Context overflow can cause incomplete or truncated output.
- **Ignoring system instructions**: Critical system prompt content gets pushed out by conversation history, leading to off-topic or misaligned behavior.

## Fetching Available Models

The `/settings providers` wizard can automatically fetch your installed Ollama models when configuring this provider.
