# Tmux Gen

A dynamic, mnemonic-based environment generator for Tmux and ZSH. It provides a unified system for managing shortcuts with searchable hints and a "which-key" style experience.

## Goals
- **Mnemonic Mastery**: Organize bindings and aliases into logical, easy-to-remember hierarchies.
- **Searchable Discoverability**: Integrated `fzf` popups (`?`) show available commands for the current mode.
- **Unified Management**: Manage both terminal aliases and tmux keybindings from a single interface.
- **AI-Friendly**: Structured YAML formats (`extend.yml`, `extend_source.yml`) with JSON schemas for easy extension.

## Usage
- **`task build`**: Generate and sync all configurations.
- **`task tui`**: Open the interactive management interface.
- **`?`**: While in a tmux mode, show a searchable command list.

## Implementation Details: `task tui`
The management interface is a modern terminal application built with **OpenTUI** (React + Bun).

- **Architecture**: The TUI logic (`tui/src/logic.ts`) consolidates configuration management, previously handled by Ruby.
- **Multi-Target**: Supports toggling between `ZSH` (aliases) and `TMUX` (bindings) targets with the `t` key.
- **Dynamic Rendering**: Features a custom scrollbox implementation for navigating large lists of bindings without clipping.
- **Smart Syncing**: The `s` key in the TUI triggers the appropriate generation engine for the active target, creating `extra.conf` for Tmux or `dev.extend.zsh` for shell aliases.
- **Schemas**: Full JSON schema support for validation and editor autocompletion.
