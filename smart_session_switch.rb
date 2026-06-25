#!/usr/bin/env ruby
# Smart session switcher that skips the "DUMP" session

direction = ARGV[0] == 'prev' ? -1 : 1
current_session = `tmux display-message -p '#S'`.strip
all_sessions = `tmux list-sessions -F '\#{session_name}'`.split("\n")

# Filter out DUMP (unless we are already in it)
filtered = all_sessions.reject { |s| s == "DUMP" }

# If we are in DUMP, we want to be able to get out, so we keep the full list in that case
target_list = (current_session == "DUMP") ? all_sessions : filtered

idx = target_list.index(current_session) || 0
next_idx = (idx + direction) % target_list.size
target_session = target_list[next_idx]

system("tmux switch-client -t #{target_session}")
