#!/usr/bin/env ruby

require 'yaml'
require 'shellwords'
require 'fileutils'
require 'rbconfig'

EXTEND_YML = File.expand_path('extend.yml', __dir__)
HELPER_SCRIPT = File.expand_path('tmux_mode_helper.rb', __dir__)
SMART_SWITCH = File.expand_path('smart_session_switch.rb', __dir__)
HINTS_DIR = File.expand_path('hints', __dir__)
RUBY_BIN = RbConfig.ruby

FileUtils.mkdir_p(HINTS_DIR)

data_content = File.read(EXTEND_YML)
data_content.gsub!('#{smart_session_switch}', SMART_SWITCH)
raw_data = YAML.load(data_content)

def resolve_bundles(entries)
  resolved = []
  queue = entries.dup
  processed = {}

  until queue.empty?
    entry = queue.shift
    name, table_data = entry.first
    next if processed[name]
    
    if table_data['mount'] == false
      processed[name] = true
      next
    end

    processed[name] = true

    new_binds = []
    table_data['binds']&.each do |bind|
      if bind['mount'] == false
        next
      end

      if bind['bundle']
        bundle_path = File.expand_path(bind['bundle'], File.dirname(EXTEND_YML))
        if File.exist?(bundle_path)
          bundle_content = YAML.load_file(bundle_path)
          bundle_name = File.basename(bundle_path, '.extend.yml')
          
          new_binds << {
            'key' => bind['key'],
            'table' => bundle_name,
            'description' => bind['description'] || bundle_content['description'] || bundle_name
          }

          unless processed[bundle_name] || queue.any? { |e| e.key?(bundle_name) }
            bundle_table_binds = []
            bundle_content['children']&.each do |k, v|
              if v.is_a?(Hash)
                type = v.key?('exec') ? 'exec' : (v.key?('send') ? 'send' : nil)
                action = v['exec'] || v['send'] || v['action']
                bundle_table_binds << {
                  'key' => k,
                  'type' => type,
                  'action' => action,
                  'description' => v['description']
                }
              else
                bundle_table_binds << { 'key' => k, 'action' => v }
              end
            end
            queue << { bundle_name => { 'binds' => bundle_table_binds, 'modal' => true } }
          end
        else
          STDERR.puts "Warning: Bundle not found: #{bundle_path}"
        end
      else
        new_binds << bind
      end
    end
    
    resolved << { name => table_data.merge('binds' => new_binds) }
  end
  resolved
end

data = resolve_bundles(raw_data)

def dependency_met?(dep)
  return true if dep.nil? || dep.empty?
  system("which #{Shellwords.escape(dep)} > /dev/null 2>&1")
end

def format_bind(bind)
  key = bind['key']
  action = bind['action'] || "Mode: #{bind['table']}"
  desc = bind['description'] || ""
  "#{key.ljust(8)} │ #{desc.ljust(35)} │ #{action}"
end

def format_all_bind(table_name, bind)
  key = bind['key']
  action = bind['action'] || "Mode: #{bind['table']}"
  desc = bind['description'] || ""
  full_desc = "#{table_name}: #{desc}"
  "#{table_name.ljust(10)}: #{key.ljust(8)} │ #{full_desc.ljust(45)} │ #{action}"
end

def get_action(bind, table_name, is_modal)
  action = bind['action']
  
  if action.nil? && bind['table']
    target_table = bind['table']
    return "switch-client -T#{target_table} \\; display-message '#{target_table}'"
  end

  case bind['type']
  when 'exec'
    action = "send-keys #{Shellwords.escape(action)} Enter"
  when 'send'
    action = "send-keys #{Shellwords.escape(action)}"
  when 'test'
    action = "display-message #{Shellwords.escape(action)}"
  when 'run'
    action = "run -b #{Shellwords.escape(action)}"
  end

  if is_modal
    action += " \\; switch-client -T#{table_name}"
  end
  
  action
end

all_binds_for_palette = []

all_generated = data.map do |entry|
  name, table_data = entry.first
  modal = table_data['modal'] == true
  
  # Filter binds based on dependency
  valid_binds = table_data["binds"].select do |bind|
    dependency_met?(bind['dependency'])
  end

  # Generate pre-formatted hint file
  hint_lines = valid_binds.map do |b| 
    all_binds_for_palette << format_all_bind(name, b) unless name == 'root'
    format_bind(b) 
  end
  File.write(File.join(HINTS_DIR, "#{name}.txt"), hint_lines.join("\n"))
  
  lines = []
  lines << "# table: #{name}"
  lines << "# modal: #{modal}"
  lines << "unbind-key -a -T#{name}" unless ['root', 'prefix'].include?(name)
  
  # Add help bind to non-root and non-prefix tables
  unless ['root', 'prefix'].include?(name)
    lines << "bind-key -T#{name} ? display-popup -E -w 80% -h 40% \"#{RUBY_BIN} --disable-gems #{HELPER_SCRIPT} fuzzy #{name}\""
  end
  
  valid_binds.each do |bind|
    key = bind["key"]
    # Special case for 'h' in 'extend' to use the palette
    if name == 'extend' && key == 'h'
        action = "display-popup -E -w 90% -h 60% \"#{RUBY_BIN} --disable-gems #{HELPER_SCRIPT} palette\""
    else
        action = get_action(bind, name, modal)
    end
    lines << "bind-key -T#{name} #{key} #{action}"
  end
  
  lines.join("\n")
end

# Write the all.txt for palette
File.write(File.join(HINTS_DIR, "all.txt"), all_binds_for_palette.join("\n"))

puts all_generated.join("\n")
