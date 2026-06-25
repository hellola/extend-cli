#!/usr/bin/env ruby
# Helper for tmux_gen.rb to provide hints and fuzzy search for modes

require 'yaml'
require 'shellwords'
require 'rbconfig'

EXTEND_YML = File.expand_path('extend.yml', __dir__)
HINTS_DIR = File.expand_path('hints', __dir__)
RUBY_BIN = RbConfig.ruby

def load_data
  YAML.load_file(EXTEND_YML)
end

def find_mode(data, mode_name)
  entry = data.find { |t| t.keys.first == mode_name }
  entry ? entry[mode_name] : nil
end

def execute_bind(key, mode_name)
  data = load_data
  mode = find_mode(data, mode_name)
  return unless mode && mode['binds']
  
  bind = mode['binds'].find { |b| b['key'] == key }
  return unless bind

  is_modal = (mode['modal'] == true)
  action = bind['action']
  
  if action.nil? && bind['table']
    # It's a table switch
    target = bind['table']
    if target == 'all'
      tmux_cmd = "display-popup -E -w 90% -h 60% \"#{RUBY_BIN} --disable-gems #{__FILE__} palette\""
    else
      tmux_cmd = "switch-client -T#{target} \\; display-message '#{target}'"
    end
  else
    # Standard action
    case bind['type']
    when 'exec'
      tmux_cmd = "send-keys #{Shellwords.escape(action)} Enter"
    when 'send'
      tmux_cmd = "send-keys #{Shellwords.escape(action)}"
    when 'run'
      tmux_cmd = "run -b #{Shellwords.escape(action)}"
    else
      tmux_cmd = action
    end
    
    if is_modal
      tmux_cmd += " \\; switch-client -T#{mode_name}"
    end
  end
  
  system("tmux #{tmux_cmd}")
end

begin
  command = ARGV[0]
  mode_name = ARGV[1]

  case command
  when 'fuzzy'
    hint_file = File.join(HINTS_DIR, "#{mode_name}.txt")
    
    fzf_command = [
      "fzf",
      "--header='Mode: #{mode_name} | Search keys or descriptions'",
      "--delimiter='│'",
      "--with-nth=1..",
      "--height=100%",
      "--layout=reverse",
      "--border=none",
      "--no-info",
      "--tiebreak=begin,length",
      "--sync"
    ].join(" ")

    selected = `#{fzf_command} < #{Shellwords.escape(hint_file)}`.strip
    
    if !selected.empty?
      key = selected.split('│').first.strip
      execute_bind(key, mode_name)
    end

  when 'palette'
    hint_file = File.join(HINTS_DIR, "all.txt")
    
    fzf_command = [
      "fzf",
      "--header='Command Palette | Search all modes'",
      "--delimiter='│'",
      "--with-nth=1..",
      "--height=100%",
      "--layout=reverse",
      "--border=none",
      "--no-info",
      "--tiebreak=begin,length",
      "--sync"
    ].join(" ")

    selected = `#{fzf_command} < #{Shellwords.escape(hint_file)}`.strip
    
    if !selected.empty?
        # Format is "Table     : Key      │ Description │ Action"
        parts = selected.split('│')
        first_part = parts[0].strip
        # "Table     : Key"
        table_part, key = first_part.split(':')
        table_name = table_part.strip
        key = key.strip
        
        execute_bind(key, table_name)
    end
  end
rescue => e
  File.open("/tmp/tmux_mode_helper.log", "a") do |f|
    f.puts "[#{Time.now}] Error: #{e.message}"
    f.puts e.backtrace
  end
  exit 1
end
