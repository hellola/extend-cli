# Agent Context: Tmux Mode Generator

This repository contains a dynamic, mnemonic-based keybinding generator for Tmux. It is designed to be easily extended by both humans and AI agents.

## Core Components

- **`extend.yml`**: The source of truth. Define your modes (key tables) and bindings here. 
    - `table`: Switch to another key table.
    - `type: exec`: Run a command in the terminal.
    - `type: send`: Send keys to the terminal.
    - `modal: true`: Stay in this mode after executing a command (useful for resizing or session switching).
    - `dependency`: Only bind the key if the specified command is available in the system PATH.
- **`tmux_gen.rb`**: Processes `extend.yml` and generates Tmux `bind-key` commands. It also pre-generates "hint" text files for fzf.
- **`tmux_mode_helper.rb`**: Provides the runtime logic for the fzf-based command palette and contextual help popups.
- **`smart_session_switch.rb`**: A helper script to navigate sessions while skipping unwanted ones (like a "DUMP" session).

## How to Extend (for Agents)

1.  **Analyze `extend.yml`**: Understand the current mode structure.
2.  **Add Bindings**: Add new entries to `extend.yml`. Always include a `description` as it is used in the fuzzy search menu.
3.  **Regenerate**: Run `task build` (or `ruby tmux_gen.rb > extra.conf`) to apply changes.
4.  **Verify**: Ensure the generated Tmux commands are valid.

## Goal

The goal is to provide a "which-key" style experience for Tmux that is completely customizable. By using fzf popups, the user (and the agent) can manage hundreds of bindings without remembering every single key.
