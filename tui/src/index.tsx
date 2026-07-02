import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { App } from "./App.js";
import { loadTree, syncZsh, syncTmux, loadConfig, STRATEGIES } from "./logic.js";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const config = loadConfig();

  yargs(hideBin(process.argv))
    .command('$0', 'Start the TUI', () => {}, async () => {
      try {
        const target = process.env.TARGET === 'tmux' ? 'tmux' : 'zsh';
        const initialSourcePath = config.renderers[target]?.source_path || config.renderers['zsh']?.source_path;
        
        if (!initialSourcePath) {
          console.error("No enabled renderers found in config.json");
          process.exit(1);
        }

        const tree = loadTree(initialSourcePath);
        const renderer = await createCliRenderer({
          exitOnCtrlC: true
        });
        const root = createRoot(renderer);

        const handleExit = (command?: string) => {
          root.unmount();
          renderer.destroy();
          if (command) {
            console.log(`Executing: ${command}`);
          }
          process.exit(0);
        };

        root.render(<App initialTree={tree} onExit={handleExit} />);
      } catch (e) {
        console.error("Failed to start TUI:", e);
        process.exit(1);
      }
    })
    .command('sync', 'Sync all enabled configurations', () => {}, () => {
      console.log("Syncing all configurations...");
      if (config.renderers.zsh?.enabled) {
        console.log("Syncing Zsh aliases...");
        syncZsh();
      }
      if (config.renderers.tmux?.enabled) {
        console.log("Syncing Tmux configuration...");
        syncTmux();
      }
      console.log("Done!");
    })
    .command('install-scripts', 'Print source commands for enabled tools', () => {}, () => {
      Object.entries(config.renderers).forEach(([id, r]) => {
        if (r.enabled) {
          const strategy = STRATEGIES[id];
          if (strategy) {
            console.log(strategy.getSourceCommand(r.output_path));
          }
        }
      });
      // Also suggest the fzf search script
      const fzfScript = path.join(config.renderers.zsh.source_path.replace(/[^\/]+$/, ''), 'fzf_search.zsh');
      if (fs.existsSync(fzfScript)) {
        console.log(`source ${fzfScript}`);
      }
    })
    .help()
    .parse();
}

main();
