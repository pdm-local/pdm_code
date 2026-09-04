---
title: "Uninstalling"
description: "How to uninstall PDM Code and clean up configuration files"
sidebar_order: 3
---

# Uninstalling PDM Code

## Removing the build

PDM Code is not installed from a package registry. It runs from a checkout of this
repository, so removing it means deleting the checkout:

```bash
rm -rf /path/to/pdm_code
```

If you exposed it globally with `pnpm link --global`, unlink it first:

```bash
pnpm unlink --global
```

If you used the Nix flake, remove it from your `configuration.nix` or `flake.nix` and
rebuild. Nothing needs uninstalling after a bare `nix run`.

## Troubleshooting

If `pdm` still works after uninstalling, your shell may have cached the old path. Restart your terminal or run:

```bash
hash -r
```

If it persists, you may have multiple installations. Run `which pdm` again to find the remaining one and uninstall using the appropriate method above.

## Removing Configuration Files

To also remove PDM Code's configuration and preferences:

```bash
# macOS
rm -rf ~/Library/Preferences/pdm/

# Linux
rm -rf ~/.config/pdm/

# Windows (PowerShell)
Remove-Item -Recurse -Force $env:APPDATA\pdm

# Per-project config (in each project directory)
rm -f .mcp.json
rm -rf .pdm/
```
