# Tmux Mode Generator

A dynamic, mnemonic-based keybinding system for Tmux. It allows you to create "modes" (key tables) with searchable hints, a global command palette, and dependency-aware bindings.

## Features

- **Mnemonic Key Tables**: Organize your bindings into logical modes (e.g., `prefix` -> `w` for window mode).
- **Searchable Hints**: Press `?` in any mode to see a searchable `fzf` popup of available commands.
- **Global Command Palette**: A single shortcut (`^e h` by default) to search across all your custom bindings.
- **Dependency Checks**: Bindings are only created if the required tools (like `rails`, `git`, or `ranger`) are installed.
- **Smart Session Switching**: Skip "utility" sessions (like a `DUMP` session) when cycling through your active work.

## Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/youruser/tmux-gen.git ~/.config/tmux-gen
    ```

2.  **Dependencies**:
    - Ruby (for generation and helper logic)
    - `fzf` (for popups)
    - `task` (optional, for build automation)

3.  **Integrate with Tmux**:
    Add the following to your `~/.tmux.conf`:
    ```tmux
    # Generate and load the custom bindings
    run-shell "ruby ~/.config/tmux-gen/tmux_gen.rb > ~/.config/tmux-gen/extra.conf"
    source-file ~/.config/tmux-gen/extra.conf
    ```

4.  **Customize**:
    Edit `extend.yml` to define your own keys and modes, then run `task` (or the `run-shell` command above) to reload.

## How it Works

- **`extend.yml`**: Your configuration file.
- **`tmux_gen.rb`**: The engine that turns your YAML into Tmux config.
- **`tmux_mode_helper.rb`**: Powers the interactive popups.

## AI-First Workflow

This repo is designed to be "AI-friendly." If you are using an AI coding assistant, simply point it at this directory and ask it to "Add a new mode for [my tool]" or "Make my session switching skip [session name]".
