import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import { RGBA } from '@opentui/core';
import fuzzysort from 'fuzzysort';
import { type Entry, type Tree, type GroupedItem } from './types.js';
import { getAllEntries, saveTree, syncZsh, syncTmux, loadTree, STRATEGIES, loadConfig } from './logic.js';
import * as path from 'path';

interface AppProps {
  initialTree: Tree;
  onExit: (command?: string) => void;
}

export const App: React.FC<AppProps> = ({ initialTree, onExit }) => {
  const [target, setTarget] = useState<'zsh' | 'tmux'>(process.env.TARGET === 'tmux' ? 'tmux' : 'zsh');
  const [tree, setTree] = useState(initialTree);
  const [mode, setMode] = useState<'normal' | 'search' | 'navigate' | 'add' | 'edit'>('normal');
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [navigateQuery, setNavigateQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchFocus, setSearchFocus] = useState<'input' | 'list'>('input');

  const currentStrategy = STRATEGIES[target];
  const appConfig = useMemo(() => loadConfig(), []);
  const currentFile = useMemo(() => {
    return appConfig.renderers[target]?.source_path || "";
  }, [appConfig, target]);

  const [formCategory, setFormCategory] = useState('');
  const [formMnemonic, setFormMnemonic] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formField, setFormField] = useState(0);
  const [categorySelectedIndex, setCategorySelectedIndex] = useState(0);

  const [isPlatformSpecific, setIsPlatformSpecific] = useState(false);
  const [platformCommands, setPlatformCommands] = useState<{ platform: string, cmd: string }[]>([{ platform: 'default', cmd: '' }]);
  const PLATFORMS = ['default', 'darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos'];

  const categories = useMemo(() => {
    const results: { label: string, category: string, mnemonic: string }[] = [];
    const walk = (node: any, label: string, category: string, mnemonic: string, key: string) => {
      const desc = node.tableDescription || node.description || key;
      const currentLabel = (label.toLowerCase() === desc.toLowerCase()) ? label : `${label} -> ${desc}`;
      
      if (!node.exec) {
        results.push({ label: currentLabel, category, mnemonic });
      }
      if (node.children) {
        Object.entries(node.children).forEach(([k, child]) => {
          walk(child, currentLabel, category, mnemonic + k, k);
        });
      }
    };
    Object.entries(tree).forEach(([category, rootNodes]) => {
      results.push({ label: category, category, mnemonic: "" });
      if (typeof rootNodes === 'object' && rootNodes !== null) {
        Object.entries(rootNodes).forEach(([key, node]) => {
          walk(node, category, category, key, key);
        });
      }
    });
    const seen = new Set<string>();
    const uniqueResults: typeof results = [];
    results.forEach(r => {
      const key = `${r.label}|${r.category}|${r.mnemonic}`;
      if (!seen.has(key)) {
        uniqueResults.push(r);
        seen.add(key);
      }
    });
    return uniqueResults;
  }, [tree]);

  const filteredCategories = useMemo(() => {
    if (!formCategory) return [];
    return fuzzysort.go(formCategory, categories, {
      keys: ['label', 'category'],
      limit: 10,
      threshold: -10000
    }).map(r => r.obj);
  }, [categories, formCategory]);

  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);

  const [showDebug, setShowDebug] = useState(false);
  const [keyHistory, setKeyHistory] = useState<string[]>([]);


  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();

  const allEntries = useMemo(() => getAllEntries(tree, currentStrategy), [tree, currentStrategy]);

  const groupedItems = useMemo(() => {
    if (viewMode === 'flat') return [];

    const items: GroupedItem[] = [];

    const walkTree = (node: any, path: string, level: number, label: string) => {
      const hasChildren = node.children && Object.keys(node.children).length > 0;
      const isExpanded = expandedPaths.has(path);

      const item: GroupedItem = {
        id: path,
        level,
        type: node.exec ? 'leaf' : 'table',
        label: label,
        description: node.tableDescription || node.description,
        isExpanded,
        hasChildren,
        node
      };

      if (node.exec) {
        // Find matching entry to get mnemonic and name
        item.entry = allEntries.find(e => e.node === node);
      }

      items.push(item);

      if (hasChildren && isExpanded) {
        Object.entries(node.children).forEach(([key, child]) => {
          walkTree(child, `${path}.${key}`, level + 1, key);
        });
      }
    };

    Object.entries(tree).forEach(([category, rootNodes]) => {
      const path = category;
      const isExpanded = expandedPaths.has(path);

      items.push({
        id: path,
        level: 0,
        type: 'category',
        label: category,
        isExpanded,
        hasChildren: true,
      });

      if (isExpanded) {
        Object.entries(rootNodes as any).forEach(([key, node]) => {
          walkTree(node, `${path}.${key}`, 1, key);
        });
      }
    });

    return items;
  }, [tree, expandedPaths, viewMode, allEntries]);

  const filteredEntries = useMemo(() => {
    if (mode === 'search' && searchQuery) {
      return fuzzysort.go(searchQuery, allEntries, { keys: ['mnemonic', 'name', 'category', 'description'] }).map(r => r.obj);
    }

    if (viewMode === 'grouped') return groupedItems;

    if (mode === 'navigate') {
      return allEntries.filter(e => e.mnemonic.startsWith(navigateQuery));
    }
    return allEntries;
  }, [allEntries, searchQuery, navigateQuery, mode, viewMode, groupedItems]);

  useEffect(() => {
    if (mode === 'search' && searchFocus === 'input') {
      setSelectedIndex(0);
    }
  }, [searchQuery, mode, searchFocus]);

  const selectedEntry = useMemo(() => {
    const item = filteredEntries[selectedIndex];
    if (!item) return null;
    if (viewMode === 'flat' || (mode === 'search' && searchQuery) || mode === 'navigate') return item as Entry;
    return (item as GroupedItem).entry || null;
  }, [filteredEntries, selectedIndex, viewMode, mode, searchQuery]);

  useEffect(() => {
    if (selectedIndex >= filteredEntries.length && filteredEntries.length > 0) {
      setSelectedIndex(filteredEntries.length - 1);
    }
  }, [filteredEntries.length, selectedIndex]);

  useEffect(() => {
    if (mode === 'navigate' && filteredEntries.length === 1 && navigateQuery.length > 0) {
      const entry = (filteredEntries[0] as Entry);
      if (entry.cmd) onExit(entry.cmd);
    }
  }, [filteredEntries, navigateQuery, mode, onExit]);

  const handleDelete = useCallback(() => {
    if (!selectedEntry) return;
    if (selectedEntry.source) {
      renderer.console.show();
      console.warn("Cannot delete entry from external bundle yet.");
      return;
    }
    const newTree = JSON.parse(JSON.stringify(tree));
    const mChars = currentStrategy.splitMnemonic(selectedEntry.mnemonic);
    if (!newTree[selectedEntry.category]) return;

    const breadcrumbs: { map: any, key: string }[] = [{ map: newTree, key: selectedEntry.category }];
    let tempCurr = newTree[selectedEntry.category];
    mChars.forEach((char: string, idx: number) => {
      if (tempCurr[char]) {
        if (idx === mChars.length - 1) {
          delete tempCurr[char];
        } else if (tempCurr[char].children) {
          breadcrumbs.push({ map: tempCurr, key: char });
          tempCurr = tempCurr[char].children;
        }
      }
    });

    for (let i = breadcrumbs.length - 1; i >= 0; i--) {
      const { map, key } = breadcrumbs[i];
      const node = map[key];
      if (i === 0) {
        if (Object.keys(node).length === 0) delete map[key];
      } else {
        const hasChildren = node.children && Object.keys(node.children).length > 0;
        const hasExec = !!node.exec;
        if (!hasChildren && !hasExec) {
          const p = breadcrumbs[i - 1];
          if (i === 1) delete p.map[p.key][key];
          else delete p.map[breadcrumbs[i - 1].key].children[key];
        }
      }
    }
    setTree(newTree);
    saveTree(newTree, currentFile);
  }, [selectedEntry, tree, renderer, currentFile, currentStrategy]);

  const handleAdd = useCallback(() => {
    if (!formCategory || !formMnemonic || !formDescription) return;
    const finalCommand = isPlatformSpecific 
      ? Object.fromEntries(platformCommands.filter(p => p.cmd).map(p => [p.platform, p.cmd]))
      : formCommand;
    
    if (!finalCommand || (typeof finalCommand === 'object' && Object.keys(finalCommand).length === 0)) return;

    const newTree = JSON.parse(JSON.stringify(tree));
    const mChars = currentStrategy.splitMnemonic(formMnemonic);
    const dWords = formDescription.split('-');
    if (!newTree[formCategory]) newTree[formCategory] = {};
    let curr = newTree[formCategory];
    mChars.forEach((char: string, i: number) => {
      if (!curr[char]) {
        curr[char] = { description: dWords[i] || '' };
      }
      if (i === mChars.length - 1) {
        curr[char].exec = finalCommand;
        curr[char].description = formDescription;
      } else {
        if (!curr[char].children) curr[char].children = {};
        curr = curr[char].children;
      }
    });
    setTree(newTree);
    saveTree(newTree, currentFile);

    // Auto-sync
    if (target === 'zsh') syncZsh();
    else syncTmux();

    setMode('normal');
    setFormCategory(''); setFormMnemonic(''); setFormDescription(''); setFormCommand('');
    setIsPlatformSpecific(false);
    setPlatformCommands([{ platform: 'default', cmd: '' }]);
  }, [formCategory, formMnemonic, formDescription, formCommand, tree, currentFile, currentStrategy, target, isPlatformSpecific, platformCommands]);

  const handleSaveEdit = useCallback(() => {
    if (!editingEntry || !formCategory || !formMnemonic || !formDescription) return;
    
    const finalCommand = isPlatformSpecific 
      ? Object.fromEntries(platformCommands.filter(p => p.cmd).map(p => [p.platform, p.cmd]))
      : formCommand;

    if (!finalCommand || (typeof finalCommand === 'object' && Object.keys(finalCommand).length === 0)) return;

    const newTree = JSON.parse(JSON.stringify(tree));

    // 1. Remove old entry
    const oldMnemonicParts = currentStrategy.splitMnemonic(editingEntry.mnemonic);
    if (newTree[editingEntry.category]) {
      let curr = newTree[editingEntry.category];
      const path: { node: any, key: string }[] = [];

      for (let i = 0; i < oldMnemonicParts.length; i++) {
        const key = oldMnemonicParts[i];
        if (curr[key]) {
          path.push({ node: curr, key });
          if (i < oldMnemonicParts.length - 1) {
            curr = curr[key].children || {};
          }
        }
      }

      if (path.length > 0) {
        const last = path[path.length - 1];
        const oldNode = last.node[last.key];
        delete last.node[last.key];

        // 2. Add new entry (potentially preserving children)
        const newMnemonicParts = currentStrategy.splitMnemonic(formMnemonic);
        if (!newTree[formCategory]) newTree[formCategory] = {};
        let newCurr = newTree[formCategory];

        newMnemonicParts.forEach((char: string, i: number) => {
          if (!newCurr[char]) {
            newCurr[char] = { description: '' };
          }
          if (i === newMnemonicParts.length - 1) {
            newCurr[char].exec = finalCommand;
            newCurr[char].description = formDescription;
            if (oldNode.children) newCurr[char].children = oldNode.children;
          } else {
            if (!newCurr[char].children) newCurr[char].children = {};
            newCurr = newCurr[char].children;
          }
        });
      }
    }

    setTree(newTree);
    saveTree(newTree, currentFile);

    // Auto-sync
    if (target === 'zsh') syncZsh();
    else syncTmux();

    setMode('normal');
    setEditingEntry(null);
    setIsPlatformSpecific(false);
    setPlatformCommands([{ platform: 'default', cmd: '' }]);
  }, [editingEntry, formCategory, formMnemonic, formDescription, formCommand, tree, currentFile, target, currentStrategy, isPlatformSpecific, platformCommands]);

  useKeyboard((e) => {
    setKeyHistory(prev => [JSON.stringify(e), ...prev].slice(0, 10));

    if (e.ctrl && e.name === 'l') {
      setShowDebug(v => !v);
      return;
    }

    if (mode === 'normal') {
      if (e.name === 'j' || e.name === 'l' || (e.ctrl && (e.name === 'n' || e.name === 'f')) || e.name === 'down') {
        setSelectedIndex(s => Math.min(s + 1, filteredEntries.length - 1));
      }
      if (e.name === 'k' || e.name === 'h' || (e.ctrl && (e.name === 'p' || e.name === 'b')) || e.name === 'up') {
        setSelectedIndex(s => Math.max(s - 1, 0));
      }
      if (e.name === 'q') onExit();
      if (e.name === 't') setTarget(t => t === 'zsh' ? 'tmux' : 'zsh');
      if (e.name === 'g') setViewMode(v => v === 'flat' ? 'grouped' : 'flat');
      if (e.name === 'e' || (e.ctrl && e.name === 'e')) {
        if (selectedEntry) {
          setEditingEntry(selectedEntry);
          setFormCategory(selectedEntry.category);
          setFormMnemonic(selectedEntry.mnemonic);
          setFormDescription(selectedEntry.description);
          setFormCommand(typeof selectedEntry.node?.exec === 'string' ? selectedEntry.node.exec : '');
          setIsPlatformSpecific(typeof selectedEntry.node?.exec === 'object');
          if (typeof selectedEntry.node?.exec === 'object') {
            setPlatformCommands(Object.entries(selectedEntry.node.exec).map(([platform, cmd]) => ({ platform, cmd })));
          } else {
            setPlatformCommands([{ platform: 'default', cmd: '' }]);
          }
          setMode('edit');
          setFormField(1); // Default to editing mnemonic
        }
      }
      if (e.name === '/') { setMode('search'); setSearchQuery(''); setSelectedIndex(0); setSearchFocus('input'); }
      if (e.name === 'n') { setMode('navigate'); setNavigateQuery(''); }
      if (e.name === 'a') {
        setMode('add');
        setFormField(0);
        setEditingEntry(null);
        setFormCategory('');
        setFormMnemonic('');
        setFormDescription('');
        setFormCommand('');
        setIsPlatformSpecific(false);
        setPlatformCommands([{ platform: 'default', cmd: '' }]);
      }
      if (e.name === 'd' || (e.ctrl && e.name === 'd')) handleDelete();
      if (e.name === 'l' && viewMode === 'grouped') {
        const item = filteredEntries[selectedIndex] as any;
        if (item && item.hasChildren) {
          setExpandedPaths(prev => {
            const next = new Set(prev);
            next.add(item.id);
            return next;
          });
        }
      }
      if (e.name === 'h' && viewMode === 'grouped') {
        const item = filteredEntries[selectedIndex] as any;
        if (item) {
          if (item.isExpanded) {
            setExpandedPaths(prev => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
            });
          } else {
            // Find parent
            const lastDot = item.id.lastIndexOf('.');
            if (lastDot !== -1) {
              const parentId = item.id.substring(0, lastDot);
              const parentIndex = filteredEntries.findIndex((it: any) => it.id === parentId);
              if (parentIndex !== -1) setSelectedIndex(parentIndex);
            }
          }
        }
      }
      if (e.name === 's') {
        if (target === 'zsh') syncZsh();
        else syncTmux();
        renderer.console.show();
        console.log(`Synced ${target.toUpperCase()}!`);
      }
      if (e.name === 'enter' || e.name === 'return') {
        if (viewMode === 'grouped') {
          const item = filteredEntries[selectedIndex] as GroupedItem;
          if (item && item.hasChildren) {
            setExpandedPaths(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
            return;
          }
        }

        if (selectedEntry?.cmd) {
          onExit(selectedEntry.cmd);
        }
      }

      if (e.name === 'escape') {
        if (renderer.console.visible) {
          renderer.console.hide();
        }
      }
    } else if (mode === 'search') {
      if (e.name === 'enter') onExit(selectedEntry?.cmd);
      if (e.name === 'tab') {
        setSearchFocus(f => f === 'input' ? 'list' : 'input');
      } else if (searchFocus === 'list' || e.name === 'down' || e.name === 'up' || (e.ctrl && (e.name === 'n' || e.name === 'p'))) {
        if (e.name === 'j' || e.name === 'down' || (e.ctrl && e.name === 'n')) {
          setSelectedIndex(s => Math.min(s + 1, filteredEntries.length - 1));
        }
        if (e.name === 'k' || e.name === 'up' || (e.ctrl && e.name === 'p')) {
          setSelectedIndex(s => Math.max(s - 1, 0));
        }
        if (e.name === 'e' && selectedEntry) {
          setEditingEntry(selectedEntry);
          setFormCategory(selectedEntry.category);
          setFormMnemonic(selectedEntry.mnemonic);
          setFormDescription(selectedEntry.description);
          setFormCommand(typeof selectedEntry.node?.exec === 'string' ? selectedEntry.node.exec : '');
          setIsPlatformSpecific(typeof selectedEntry.node?.exec === 'object');
          if (typeof selectedEntry.node?.exec === 'object') {
            setPlatformCommands(Object.entries(selectedEntry.node.exec).map(([platform, cmd]) => ({ platform, cmd })));
          } else {
            setPlatformCommands([{ platform: 'default', cmd: '' }]);
          }
          setMode('edit');
          setFormField(1);
        }
        if (e.name === 'd') handleDelete();
      }

      if (e.ctrl && e.name === 'e' && selectedEntry) {
        setEditingEntry(selectedEntry);
        setFormCategory(selectedEntry.category);
        setFormMnemonic(selectedEntry.mnemonic);
        setFormDescription(selectedEntry.description);
        setFormCommand(typeof selectedEntry.node?.exec === 'string' ? selectedEntry.node.exec : '');
        setIsPlatformSpecific(typeof selectedEntry.node?.exec === 'object');
        if (typeof selectedEntry.node?.exec === 'object') {
          setPlatformCommands(Object.entries(selectedEntry.node.exec).map(([platform, cmd]) => ({ platform, cmd })));
        } else {
          setPlatformCommands([{ platform: 'default', cmd: '' }]);
        }
        setMode('edit');
        setFormField(1);
      }

      if (e.ctrl && e.name === 'd' && selectedEntry) {
        handleDelete();
      }

      if (e.name === 'escape') setMode('normal');
      if (e.name === 'enter' || e.name === 'return') onExit(selectedEntry?.cmd);
    } else if (mode === 'navigate') {
      if (e.name === 'escape') setMode('normal');
      if (e.name === 'enter' || e.name === 'return') onExit(selectedEntry?.cmd);
      else if (e.name === 'backspace') setNavigateQuery(q => q.slice(0, -1));
      else if (e.name.length === 1) setNavigateQuery(q => q + e.name);
    } else if (mode === 'add' || mode === 'edit') {
      if (e.name === 'escape') {
        setMode('normal');
        setEditingEntry(null);
        setFormCategory('');
        setFormMnemonic('');
        setFormDescription('');
        setFormCommand('');
        setIsPlatformSpecific(false);
        setPlatformCommands([{ platform: 'default', cmd: '' }]);
      }
      const baseFields = 4; // Category, Mnemonic, Description, Platform Specific Checkbox
      const totalFields = isPlatformSpecific ? baseFields + (platformCommands.length * 2) : baseFields + 1;

      if (e.name === 'tab' || e.name === 'backtab') {
        if (e.shift || e.name === 'backtab') {
          setFormField(f => (f - 1 + totalFields) % totalFields);
        } else {
          setFormField(f => (f + 1) % totalFields);
        }
        setCategorySelectedIndex(0);
        return;
      }

      if (formField === 0 && filteredCategories.length > 0) {
        if (e.name === 'down' || (e.ctrl && e.name === 'n')) {
          setCategorySelectedIndex(s => Math.min(s + 1, filteredCategories.length - 1));
          return;
        }
        if (e.name === 'up' || (e.ctrl && e.name === 'p')) {
          setCategorySelectedIndex(s => Math.max(s - 1, 0));
          return;
        }
        if (e.name === 'enter' || e.name === 'return') {
          const sel = filteredCategories[categorySelectedIndex];
          setFormCategory(sel.category);
          setFormMnemonic(sel.mnemonic);
          setFormField(1);
          return;
        }
      }

      if (formField === 3 && (e.name === ' ' || e.name === 'enter' || e.name === 'return')) {
        setIsPlatformSpecific(v => !v);
        return;
      }

      if (e.name === 'enter' || e.name === 'return' || (e.ctrl && e.name === 's')) {
        if (mode === 'add') handleAdd();
        else handleSaveEdit();
        return;
      }


      const setVal = (v: string) => {
        if (formField === 0) setFormCategory(v);
        if (formField === 1) setFormMnemonic(v);
        if (formField === 2) setFormDescription(v);
        if (!isPlatformSpecific) {
          if (formField === 4) setFormCommand(v);
        } else {
          const idx = Math.floor((formField - 4) / 2);
          const isPlatform = (formField - 4) % 2 === 0;
          if (idx >= 0 && idx < platformCommands.length) {
            const next = [...platformCommands];
            if (isPlatform) next[idx].platform = v;
            else next[idx].cmd = v;
            setPlatformCommands(next);
          }
        }
      };

      // Ctrl+A to add platform, Ctrl+X to remove current platform
      if (isPlatformSpecific && formField >= 4) {
        if (e.ctrl && e.name === 'a') {
          setPlatformCommands(p => [...p, { platform: 'default', cmd: '' }]);
          return;
        }
        if (e.ctrl && e.name === 'x') {
          const idx = Math.floor((formField - 4) / 2);
          if (platformCommands.length > 1) {
            setPlatformCommands(p => p.filter((_, i) => i !== idx));
            setFormField(prev => Math.max(4, prev - 2));
          }
          return;
        }
      }

      if (e.name === 'backspace') {
        if (formField === 3) return;
        const currentVal = (formField === 0 ? formCategory : 
                            formField === 1 ? formMnemonic : 
                            formField === 2 ? formDescription : 
                            !isPlatformSpecific ? (formField === 4 ? formCommand : '') :
                            (() => {
                              const idx = Math.floor((formField - 4) / 2);
                              const isPlatform = (formField - 4) % 2 === 0;
                              return isPlatform ? platformCommands[idx]?.platform : platformCommands[idx]?.cmd;
                            })());
        setVal(currentVal.slice(0, -1));
      }
      else if (e.name.length === 1 && !e.ctrl && !e.meta) {
        if (formField === 3) return;
        const currentVal = (formField === 0 ? formCategory : 
                            formField === 1 ? formMnemonic : 
                            formField === 2 ? formDescription : 
                            !isPlatformSpecific ? (formField === 4 ? formCommand : '') :
                            (() => {
                              const idx = Math.floor((formField - 4) / 2);
                              const isPlatform = (formField - 4) % 2 === 0;
                              return isPlatform ? platformCommands[idx]?.platform : platformCommands[idx]?.cmd;
                            })());
        setVal(currentVal + e.name);
      }
    }
  });

  const itemHeight = 3;
  const basePadding = 9;
  const searchPadding = mode === 'search' ? 4 : 0;
  const navigatePadding = mode === 'navigate' ? 4 : 0;
  const addPadding = (mode === 'add' || mode === 'edit') ? (isPlatformSpecific ? 10 + platformCommands.length : 10) : 0;
  const entryPadding = selectedEntry ? (typeof selectedEntry.node?.exec === 'object' ? 8 : 6) : 0;
  const focusPadding = (mode === 'search' && searchFocus === 'list') ? 2 : 0;

  const totalPadding = basePadding + searchPadding + navigatePadding + addPadding + entryPadding + focusPadding;
  const availableHeight = height - totalPadding;
  const listHeightItems = Math.max(1, Math.floor(availableHeight / itemHeight));

  const startIdx = Math.max(0, Math.min(selectedIndex - Math.floor(listHeightItems / 2), Math.max(0, filteredEntries.length - listHeightItems)));

  const getSourceDisplay = (source?: string) => {
    if (!source) return 'inline';
    return path.basename(source);
  };

  const colors = useMemo(() => ({
    fg: RGBA.defaultForeground(),
    bg: RGBA.defaultBackground(),
    magenta: RGBA.fromIndex(13), // Bright Magenta
    cyan: RGBA.fromIndex(14),    // Bright Cyan
    yellow: RGBA.fromIndex(11),  // Bright Yellow
    green: RGBA.fromIndex(10),   // Bright Green
    blue: RGBA.fromIndex(12),    // Bright Blue
    white: RGBA.fromIndex(15),
    gray: RGBA.fromIndex(8),
    darkGray: RGBA.fromIndex(0),
    selection: RGBA.fromIndex(4),
  }), []);

  const renderEntries = () => {
    return (
      <scrollbox
        style={{ flexGrow: 1 }}
        scrollTop={startIdx * itemHeight}
      >
        <box style={{ flexDirection: 'column' }}>
          {filteredEntries.map((entry: any, i) => {
            const isSelected = i === selectedIndex;

            if (viewMode === 'grouped' && !(mode === 'search' && searchQuery)) {
              const item = entry as any; // GroupedItem
              const indent = item.level * 2;
              const marker = item.hasChildren ? (item.isExpanded ? '▾' : '▸') : ' ';

              return (
                <box
                  key={item.id}
                  style={{
                    backgroundColor: isSelected ? colors.selection : undefined,
                    flexDirection: 'row',
                    height: itemHeight,
                    paddingY: 0,
                    borderBottom: true,
                    borderStyle: 'single',
                    borderColor: colors.darkGray,
                  }}
                >
                  <box style={{ height: 1, flexDirection: 'row', width: '100%', paddingLeft: indent }}>
                    <text style={{ width: 2, fg: colors.yellow }}>{marker}</text>
                    <text style={{ width: 20, fg: isSelected ? colors.white : (item.type === 'leaf' ? colors.green : colors.magenta) }}>
                      <b>{item.label}</b>
                    </text>
                    <text style={{ flexGrow: 1, fg: isSelected ? colors.white : colors.fg }}>
                      {item.description || (item.entry?.description)}
                    </text>
                    {item.type === 'leaf' && (
                      <text style={{ width: 15, fg: colors.gray }}>[{item.entry?.mnemonic}]</text>
                    )}
                  </box>
                </box>
              );
            }

            return (
              <box
                key={`${entry.category}-${entry.mnemonic}-${i}`}
                style={{
                  backgroundColor: isSelected ? colors.selection : undefined,
                  flexDirection: 'row',
                  height: itemHeight,
                  paddingY: 0,
                  justifyContent: 'space-between',
                  borderBottom: true,
                  borderStyle: 'single',
                  borderColor: colors.darkGray,
                  borderTop: false,
                  borderLeft: false,
                  borderRight: false
                }}
              >
                <box style={{ height: 1, flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                  <text style={{ width: '10%', fg: isSelected ? colors.white : colors.green }}><b>[{entry.mnemonic}]</b></text>
                  <text style={{ width: '40%', fg: isSelected ? colors.white : colors.cyan }}>{isSelected ? <b>{entry.name}</b> : entry.name}</text>
                  <text style={{ width: '20%', fg: isSelected ? colors.white : colors.fg }}>{entry.description}</text>
                  <text style={{ width: '10%', fg: isSelected ? colors.white : colors.gray }}>{entry.category}</text>
                </box>
              </box>
            );
          })}
        </box>
      </scrollbox>
    );
  };

  return (
    <box style={{ width, height, flexDirection: 'column', padding: 0, borderStyle: 'single', borderColor: colors.gray, backgroundColor: colors.bg }}>
      <box style={{ height: 1, flexDirection: 'row', justifyContent: 'space-between', paddingX: 1, marginBottom: 1 }}>
        <box style={{ flexDirection: 'row' }}>
          <text style={{ fg: colors.magenta }}><b>{target.toUpperCase()} EXTEND </b></text>
          <text style={{ fg: colors.cyan }}>[{mode.toUpperCase()}]</text>
        </box>
        <text style={{ fg: colors.yellow }}>{filteredEntries.length} items</text>
      </box>

      {mode === 'search' && (
        <box style={{ height: 3, borderStyle: 'single', borderColor: searchFocus === 'input' ? colors.yellow : colors.darkGray, paddingX: 1, marginBottom: 1 }}>
          <input value={searchQuery} placeholder="Filter" focused={searchFocus === 'input'} onInput={setSearchQuery} />
        </box>
      )}

      {mode === 'navigate' && (
        <box style={{ height: 3, borderStyle: 'single', borderColor: colors.cyan, paddingX: 1, marginBottom: 1 }}>
          <text style={{ fg: colors.cyan }}>🧭 Go to: </text>
          <text style={{ fg: colors.white, bg: colors.blue }}><b> {navigateQuery} </b></text>
        </box>
      )}

      {(mode === 'add' || mode === 'edit') && (
        <box style={{ flexDirection: 'column', borderStyle: 'single', borderColor: mode === 'add' ? colors.green : colors.yellow, padding: 1, marginBottom: 1 }}>
          <text style={{ fg: mode === 'add' ? colors.green : colors.yellow, marginBottom: 1 }}>
            <b>{mode === 'add' ? 'ADD NEW ENTRY' : 'EDIT ENTRY'}</b>
          </text>
          <box><text style={{ width: 12, fg: colors.green }}>Category: </text><input value={formCategory} focused={formField === 0} onInput={(v) => { setFormCategory(v); setCategorySelectedIndex(0); }} /></box>
          {formField === 0 && filteredCategories.length > 0 && (
            <box style={{ marginLeft: 12, flexDirection: 'column', borderColor: colors.darkGray, borderStyle: 'single', paddingX: 1 }}>
              {filteredCategories.map((sel, i) => (
                <text key={sel.label} style={{ fg: i === categorySelectedIndex ? colors.white : colors.gray, bg: i === categorySelectedIndex ? colors.selection : undefined }}>
                  {sel.label}
                </text>
              ))}
            </box>
          )}
          <box><text style={{ width: 12, fg: colors.green }}>Mnemonic: </text><input value={formMnemonic} focused={formField === 1} onInput={setFormMnemonic} /></box>
          <box><text style={{ width: 12, fg: colors.green }}>Desc: </text><input value={formDescription} focused={formField === 2} onInput={setFormDescription} /></box>
          <box><text style={{ width: 12, fg: colors.green }}>Adv. OS: </text><text style={{ fg: formField === 3 ? colors.yellow : colors.fg }}>[{isPlatformSpecific ? 'X' : ' '}] Platform Specific (Space to toggle)</text></box>
          
          {!isPlatformSpecific ? (
            <box><text style={{ width: 12, fg: colors.green }}>Command: </text><input value={formCommand} focused={formField === 4} onInput={setFormCommand} /></box>
          ) : (
            <box style={{ flexDirection: 'column' }}>
              {platformCommands.map((p, i) => (
                <box key={i} style={{ marginBottom: 0 }}>
                  <text style={{ width: 4, fg: colors.blue }}> OS: </text>
                  <input value={p.platform} focused={formField === 4 + (i * 2)} onInput={(v) => {
                    const next = [...platformCommands];
                    next[i].platform = v;
                    setPlatformCommands(next);
                  }} style={{ width: 8 }} />
                  <text style={{ fg: colors.blue }}> Cmd: </text>
                  <input value={p.cmd} focused={formField === 5 + (i * 2)} onInput={(v) => {
                    const next = [...platformCommands];
                    next[i].cmd = v;
                    setPlatformCommands(next);
                  }} />
                </box>
              ))}
              <text style={{ fg: colors.gray, marginLeft: 2 }}>[Ctrl+A] Add OS | [Ctrl+X] Remove Current OS</text>
            </box>
          )}

          <text style={{ fg: colors.gray, marginTop: 1 }}>[Tab/S-Tab] Cycle Fields | [Enter] Save | [Esc] Cancel</text>
        </box>
      )}

      {renderEntries()}

      {selectedEntry && (
        <box style={{ height: typeof selectedEntry.node?.exec === 'object' ? 7 : 5, borderStyle: 'double', borderColor: colors.gray, paddingX: 1, marginTop: 1, flexDirection: 'column' }}>
          <box>
            <text style={{ fg: colors.white }}>{selectedEntry.cmd}</text>
          </box>
          {typeof selectedEntry.node?.exec === 'object' && (
            <box style={{ flexDirection: 'column', marginTop: 1 }}>
              {Object.entries(selectedEntry.node.exec).map(([p, c]) => (
                <text key={p} style={{ fg: p === process.platform ? colors.green : colors.gray, height: 1 }}>• {p}: {c}</text>
              ))}
            </box>
          )}
        </box>
      )}

      <box style={{ height: 3, borderTop: true, borderStyle: 'single', borderColor: colors.gray, marginTop: 0, paddingX: 1 }}>
        <text style={{ fg: colors.gray }}>
          [j/k] Nav | [Enter] Run | [/] Filter | [g] Group | [h/l] Tree | [e] Edit | [d] Del | [a] Add | [s] Sync | [Ctrl+L] Debug | [q] Quit
        </text>
      </box>

      {showDebug && (
        <box style={{
          position: 'absolute',
          bottom: 4,
          right: 2,
          width: 40,
          height: 12,
          borderStyle: 'single',
          borderColor: colors.magenta,
          backgroundColor: colors.bg,
          flexDirection: 'column',
          padding: 1
        }}>
          <text style={{ fg: colors.magenta, marginBottom: 1 }}><b>DEBUG: KEY LOG</b></text>
          {keyHistory.map((k, i) => (
            <text key={i} style={{ fg: i === 0 ? colors.white : colors.gray, height: 1 }}>{k}</text>
          ))}
        </box>
      )}
    </box>
  );
};
