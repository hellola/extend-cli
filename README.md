# extend-cli

A dynamic, mnemonic-based keybinding generator and TUI for Tmux, Zsh, and Hammerspoon.

`extend-cli` bridges the gap between complex terminal workflows and human memory. It allows you to define hierarchical, mnemonic keybindings in YAML and generates the native configuration files for your favorite tools.

## The Problem
As developers, we accumulate hundreds of aliases, functions, and tmux bindings. Remembering that `gaa` is `git add --all` is easy, but remembering the binding for "resize-pane -D 5" in a specific tmux nested table or a complex Hammerspoon window management script is hard.

## The Solution
`extend-cli` provides:
1. **Mnemonic YAML Config**: Define bindings like `f` (file) -> `e` (edit) -> `c` (config).
2. **Multi-Target Rendering**: Generate `~/.zshrc` aliases, `~/.tmux.conf` key tables, and Hammerspoon Lua scripts from a single source of truth.
3. **Interactive TUI**: A React-based terminal interface to browse, search, add, and edit your bindings in real-time.
4. **Fzf Integration**: Automatically generates hint files for fuzzy-searching your commands.

## Features
- **Context Aware**: Handles platform-specific commands (different commands for `darwin` vs `linux`).
- **Smart Rendering**: Converts multi-line scripts into Zsh functions or Tmux run-shells automatically.
- **Visual Management**: Use the built-in TUI to manage your "command palette" without touching YAML.
- **Which-Key Experience**: Provides a "Which-Key" style popup in Tmux and Hammerspoon.

## Installation

```bash
npm install -g extend-cli
```

## Quick Start

1. **Initialize your config**:
   `extend-cli` looks for configuration in `~/.config/extend/config.json`.

2. **Define a binding in `zsh.extend.yml`**:
   ```yaml
   - root:
       binds:
         - key: f
           description: file
           table: file_operations
   - file_operations:
       binds:
         - key: e
           description: edit config
           action: vim ~/.zshrc
   ```

3. **Launch the TUI**:
   ```bash
   extend
   ```

4. **Sync**:
   The TUI or the CLI will generate your `.zsh` or `.conf` files. Source them in your main config:
   ```zsh
   # In .zshrc
   source ~/.config/extend/extend.zsh
   ```

## TUI Shortcuts
- `?`: Show help modal
- `/`: Search/Filter all bindings
- `g`: Toggle between Flat and Grouped (tree) view
- `a`/`e`/`d`: Add, Edit, or Delete entries
- `t`: Cycle targets (Zsh -> Tmux -> Hammerspoon)
- `s`: Sync changes to disk

## License
MIT
