import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useKeyboard, useTerminalDimensions, useRenderer, usePaste } from '@opentui/react';
import { RGBA, decodePasteBytes } from '@opentui/core';
import fuzzysort from 'fuzzysort';
import { type Entry, type Tree, type GroupedItem } from './types.js';
import { getAllEntries, saveTree, syncZsh, syncTmux, loadTree, STRATEGIES, loadConfig, resolveCommand } from './logic.js';
import * as path from 'path';
import * as fs from 'fs';

interface AppProps {
  initialTree: Tree;
  onExit: (command?: string) => void;
}

export const App: React.FC<AppProps> = ({ initialTree, onExit }) => {
  const [target, setTarget] = useState<'zsh' | 'tmux' | 'hammerspoon'>(process.env.TARGET === 'tmux' ? 'tmux' : (process.env.TARGET === 'hammerspoon' ? 'hammerspoon' : 'zsh'));
  const [tree, setTree] = useState(initialTree);
  const [mode, setMode] = useState<'normal' | 'search' | 'navigate' | 'add' | 'edit'>('normal');
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [navigateQuery, setNavigateQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchFocus, setSearchFocus] = useState<'input' | 'list'>('input');
  const formCommandRef = useRef(null)


  const currentStrategy = STRATEGIES[target];
  const appConfig = useMemo(() => loadConfig(), []);
  const currentFile = useMemo(() => appConfig.renderers[target]?.source_path || "", [appConfig, target]);

  useEffect(() => {
    if (currentFile && fs.existsSync(currentFile)) {
      setTree(loadTree(currentFile));
    }
  }, [currentFile]);

  const [formMnemonic, setFormMnemonic] = useState('');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formField, setFormField] = useState(0);

  const [isPlatformSpecific, setIsPlatformSpecific] = useState(false);
  const [platformCommands, setPlatformCommands] = useState<{ platform: string, cmd: string }[]>([{ platform: 'default', cmd: '' }]);
  const PLATFORMS = ['default', 'darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos'];

  const ZSH_TYPES = ['alias', 'function', 'export'];
  const TMUX_TYPES = ['exec', 'send', 'run', 'test'];
  const HS_TYPES = ['function'];
  const currentTypes = target === 'zsh' ? ZSH_TYPES : (target === 'tmux' ? TMUX_TYPES : HS_TYPES);

  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [keyHistory, setKeyHistory] = useState<string[]>([]);

  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();

  const allEntries = useMemo(() => getAllEntries(tree, currentStrategy), [tree, currentStrategy]);

  const groupedItems = useMemo(() => {
    if (viewMode === 'flat') return [];
    const items: GroupedItem[] = [];
    const walkTree = (node: any, pathStr: string, level: number, label: string) => {
      const hasChildren = node.children && Object.keys(node.children).length > 0;
      const isExpanded = expandedPaths.has(pathStr);
      const item: GroupedItem = {
        id: pathStr, level, type: node.exec ? 'leaf' : 'table', label,
        description: node.tableDescription || node.description, isExpanded, hasChildren, node
      };
      if (node.exec) item.entry = allEntries.find(e => e.node === node);
      items.push(item);
      if (hasChildren && isExpanded) {
        Object.entries(node.children).forEach(([key, child]) => { walkTree(child, `${pathStr}.${key}`, level + 1, key); });
      }
    };
    Object.entries(tree).forEach(([category, rootNodes]) => {
      const pathStr = category;
      const isExpanded = expandedPaths.has(pathStr);
      items.push({ id: pathStr, level: 0, type: 'category', label: category, isExpanded, hasChildren: true });
      if (isExpanded) {
        Object.entries(rootNodes as any).forEach(([key, node]) => { walkTree(node, `${pathStr}.${key}`, 1, key); });
      }
    });
    return items;
  }, [tree, expandedPaths, viewMode, allEntries]);

  const filteredEntries = useMemo(() => {
    if (mode === 'search' && searchQuery) return fuzzysort.go(searchQuery, allEntries, { keys: ['mnemonic', 'name', 'category', 'description'] }).map(r => r.obj);
    if (viewMode === 'grouped') return groupedItems;
    if (mode === 'navigate') return allEntries.filter(e => e.mnemonic.startsWith(navigateQuery));
    return allEntries;
  }, [allEntries, searchQuery, navigateQuery, mode, viewMode, groupedItems]);

  useEffect(() => { if (mode === 'search' && searchFocus === 'input') setSelectedIndex(0); }, [searchQuery, mode, searchFocus]);

  const selectedEntry = useMemo(() => {
    const item = filteredEntries[selectedIndex];
    if (!item) return null;
    if (viewMode === 'flat' || (mode === 'search' && searchQuery) || mode === 'navigate') return item as Entry;
    return (item as GroupedItem).entry || null;
  }, [filteredEntries, selectedIndex, viewMode, mode, searchQuery]);

  useEffect(() => { if (selectedIndex >= filteredEntries.length && filteredEntries.length > 0) setSelectedIndex(filteredEntries.length - 1); }, [filteredEntries.length, selectedIndex]);

  useEffect(() => {
    if (mode === 'navigate' && filteredEntries.length === 1 && navigateQuery.length > 0) {
      const entry = (filteredEntries[0] as Entry);
      if (entry.cmd) onExit(entry.cmd);
    }
  }, [filteredEntries, navigateQuery, mode, onExit]);

  const handleDelete = useCallback(() => {
    if (!selectedEntry) return;
    const newTree = JSON.parse(JSON.stringify(tree));
    const mChars = currentStrategy.splitMnemonic(selectedEntry.mnemonic);
    if (!newTree[selectedEntry.rootCategory]) return;
    const cleanupNode = (curr: any, chars: string[]): boolean => {
      const char = chars[0];
      if (!curr[char]) return false;
      if (chars.length === 1) delete curr[char];
      else if (curr[char].children) {
        if (cleanupNode(curr[char].children, chars.slice(1))) {
          if (Object.keys(curr[char].children).length === 0) delete curr[char].children;
        }
      }
      const keys = Object.keys(curr[char] || {});
      return keys.length === 0 || (keys.length === 1 && keys[0] === 'description' && !curr[char].exec);
    };
    cleanupNode(newTree[selectedEntry.rootCategory], mChars);
    if (Object.keys(newTree[selectedEntry.rootCategory]).length === 0) delete newTree[selectedEntry.rootCategory];
    setTree(newTree);
    saveTree(newTree, currentFile);
  }, [selectedEntry, tree, currentFile, currentStrategy]);

  const handleAdd = useCallback(() => {
    if (!formMnemonic || !formName) return;
    const finalCommand = isPlatformSpecific ? Object.fromEntries(platformCommands.filter(p => p.cmd).map(p => [p.platform, p.cmd])) : formCommand;
    if (!finalCommand || (typeof finalCommand === 'object' && Object.keys(finalCommand).length === 0)) return;
    const newTree = JSON.parse(JSON.stringify(tree));
    const mChars = currentStrategy.splitMnemonic(formMnemonic);
    const nParts = formName.split(/[- ]+/);
    const category = nParts[0] || 'unknown';
    if (!newTree[category]) newTree[category] = {};
    let curr = newTree[category];
    mChars.forEach((char: string, i: number) => {
      if (!curr[char]) { curr[char] = { description: nParts[i] || char }; }
      else if (nParts[i]) { curr[char].description = nParts[i]; }
      if (i === mChars.length - 1) {
        curr[char].exec = finalCommand;
        curr[char].type = formType || undefined;
      } else {
        if (!curr[char].children) curr[char].children = {};
        curr = curr[char].children;
      }
    });
    setTree(newTree);
    saveTree(newTree, currentFile);
    currentStrategy.sync();
    setMode('normal');
    setFormMnemonic(''); setFormName(''); setFormType(''); setFormCommand('');
    setIsPlatformSpecific(false); setPlatformCommands([{ platform: 'default', cmd: '' }]);
  }, [formMnemonic, formName, formType, formCommand, tree, currentFile, currentStrategy, target, isPlatformSpecific, platformCommands]);

  const handleSaveEdit = useCallback(() => {
    if (!editingEntry || !formMnemonic || !formName) return;
    const finalCommand = isPlatformSpecific ? Object.fromEntries(platformCommands.filter(p => p.cmd).map(p => [p.platform, p.cmd])) : formCommand;
    if (!finalCommand || (typeof finalCommand === 'object' && Object.keys(finalCommand).length === 0)) return;
    const newTree = JSON.parse(JSON.stringify(tree));
    if (newTree[editingEntry.rootCategory]) {
      const oldMnemonicParts = currentStrategy.splitMnemonic(editingEntry.mnemonic);
      const cleanupNode = (curr: any, chars: string[]): boolean => {
        const char = chars[0];
        if (!curr[char]) return false;
        if (chars.length === 1) delete curr[char];
        else if (curr[char].children) {
          if (cleanupNode(curr[char].children, chars.slice(1))) {
            if (Object.keys(curr[char].children).length === 0) delete curr[char].children;
          }
        }
        const keys = Object.keys(curr[char] || {});
        return keys.length === 0 || (keys.length === 1 && keys[0] === 'description' && !curr[char].exec);
      };
      cleanupNode(newTree[editingEntry.rootCategory], oldMnemonicParts);
      if (Object.keys(newTree[editingEntry.rootCategory]).length === 0) delete newTree[editingEntry.rootCategory];
    }
    const mChars = currentStrategy.splitMnemonic(formMnemonic);
    const nParts = formName.split(/[- ]+/);
    const category = nParts[0] || 'unknown';
    if (!newTree[category]) newTree[category] = {};
    let newCurr = newTree[category];
    mChars.forEach((char: string, i: number) => {
      if (!newCurr[char]) { newCurr[char] = { description: nParts[i] || char }; }
      else if (nParts[i]) { newCurr[char].description = nParts[i]; }
      if (i === mChars.length - 1) {
        newCurr[char].exec = finalCommand;
        newCurr[char].type = formType || undefined;
      } else {
        if (!newCurr[char].children) newCurr[char].children = {};
        newCurr = newCurr[char].children;
      }
    });
    setTree(newTree);
    saveTree(newTree, currentFile);
    currentStrategy.sync();
    setMode('normal');
    setEditingEntry(null);
    setIsPlatformSpecific(false); setPlatformCommands([{ platform: 'default', cmd: '' }]);
    setFormType('');
  }, [editingEntry, formMnemonic, formName, formType, formCommand, tree, currentFile, target, currentStrategy, isPlatformSpecific, platformCommands]);

  const startEditing = (entry: Entry) => {
    setEditingEntry(entry);
    setFormMnemonic(entry.mnemonic);
    const pathParts = entry.category ? entry.category.split(' -> ') : [];
    const fullName = [...pathParts, entry.description].join('-');
    setFormName(fullName);
    setFormType(entry.node?.type || (target === 'zsh' ? 'alias' : 'exec'));
    const rawExec = entry.node?.exec || entry.cmd;
    const ps = typeof rawExec === 'object' && rawExec !== null;
    setIsPlatformSpecific(ps);
    if (ps) {
      setPlatformCommands(Object.entries(rawExec as object).map(([p, c]) => ({ platform: p, cmd: c })));
      setFormCommand('');
    } else {
      setFormCommand((rawExec as string) || '');
      setPlatformCommands([{ platform: 'default', cmd: '' }]);
    }
    setMode('edit');
    setFormField(1);
  };

  usePaste((event: any) => {
    const text = decodePasteBytes(event.bytes);
    if (mode === 'add' || mode === 'edit') {
      if (formField === 0) setFormMnemonic(prev => prev + text);
      else if (formField === 1) setFormName(prev => prev + text);
      else if (formField === 4) setFormCommand(prev => prev + text);
      else if (isPlatformSpecific && formField >= 4 && (formField - 4) % 2 === 1) {
        const idx = Math.floor((formField - 4) / 2);
        const next = [...platformCommands];
        if (next[idx]) { next[idx].cmd += text; setPlatformCommands(next); }
      }
    }
  });

  useKeyboard((e) => {
    setKeyHistory(prev => [JSON.stringify(e), ...prev].slice(0, 10));
    if (confirmDelete) {
      if (e.name === 'y') { handleDelete(); setConfirmDelete(null); }
      else if (e.name === 'n' || e.name === 'escape') setConfirmDelete(null);
      return;
    }
    if (e.ctrl && e.name === 'l') { setShowDebug(v => !v); return; }

    if (mode === 'normal') {
      if (e.name === 'j' || e.name === 'l' || (e.ctrl && (e.name === 'n' || e.name === 'f')) || e.name === 'down') setSelectedIndex(s => Math.min(s + 1, filteredEntries.length - 1));
      if (e.name === 'k' || e.name === 'h' || (e.ctrl && (e.name === 'p' || e.name === 'b')) || e.name === 'up') setSelectedIndex(s => Math.max(s - 1, 0));
      if (e.name === 'q') onExit();
      if (e.name === 't') {
        const targets: ('zsh' | 'tmux' | 'hammerspoon')[] = ['zsh', 'tmux', 'hammerspoon'];
        const nextIdx = (targets.indexOf(target) + 1) % targets.length;
        setTarget(targets[nextIdx]);
      }
      if (e.name === 'g') setViewMode(v => v === 'flat' ? 'grouped' : 'flat');
      if (e.name === 'e' || (e.ctrl && e.name === 'e')) { if (selectedEntry) startEditing(selectedEntry); }
      if (e.name === '/') { setMode('search'); setSearchQuery(''); setSelectedIndex(0); setSearchFocus('input'); }
      if (e.name === 'n') { setMode('navigate'); setNavigateQuery(''); }
      if (e.name === 'a') {
        setMode('add'); setFormField(0); setEditingEntry(null);
        setFormMnemonic(''); setFormName(''); setFormType(currentTypes[0]); setFormCommand('');
        setIsPlatformSpecific(false); setPlatformCommands([{ platform: 'default', cmd: '' }]);
      }
      if (e.name === 'd' || (e.ctrl && e.name === 'd')) { if (selectedEntry) setConfirmDelete(selectedEntry); }
      if (e.name === 'l' && viewMode === 'grouped') {
        const item = filteredEntries[selectedIndex] as any;
        if (item && item.hasChildren) setExpandedPaths(prev => { const next = new Set(prev); next.add(item.id); return next; });
      }
      if (e.name === 'h' && viewMode === 'grouped') {
        const item = filteredEntries[selectedIndex] as any;
        if (item) {
          if (item.isExpanded) setExpandedPaths(prev => { const next = new Set(prev); next.delete(item.id); return next; });
          else {
            const lastDot = item.id.lastIndexOf('.');
            if (lastDot !== -1) {
              const parentId = item.id.substring(0, lastDot);
              const parentIndex = filteredEntries.findIndex((it: any) => it.id === parentId);
              if (parentIndex !== -1) setSelectedIndex(parentIndex);
            }
          }
        }
      }
      if (e.name === 's') { currentStrategy.sync(); renderer.console.show(); console.log(`Synced ${target.toUpperCase()}!`); }
      if (e.name === 'enter' || e.name === 'return') {
        if (viewMode === 'grouped') {
          const item = filteredEntries[selectedIndex] as GroupedItem;
          if (item && item.hasChildren) { setExpandedPaths(prev => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); return; }
        }
        if (selectedEntry?.cmd) onExit(selectedEntry.cmd);
      }
      if (e.name === 'escape') { if (renderer.console.visible) renderer.console.hide(); }
    } else if (mode === 'search') {
      if (e.name === 'enter') onExit(selectedEntry?.cmd);
      if (e.name === 'tab') setSearchFocus(f => f === 'input' ? 'list' : 'input');
      else if (searchFocus === 'list' || e.name === 'down' || e.name === 'up' || (e.ctrl && (e.name === 'n' || e.name === 'p'))) {
        if (e.name === 'j' || e.name === 'down' || (e.ctrl && e.name === 'n')) setSelectedIndex(s => Math.min(s + 1, filteredEntries.length - 1));
        if (e.name === 'k' || e.name === 'up' || (e.ctrl && e.name === 'p')) setSelectedIndex(s => Math.max(s - 1, 0));
      }
      if (((searchFocus === 'list' && e.name === 'e') || (e.ctrl && e.name === 'e')) && selectedEntry) startEditing(selectedEntry);
      if (((searchFocus === 'list' && e.name === 'd') || (e.ctrl && e.name === 'd')) && selectedEntry) setConfirmDelete(selectedEntry);
      if (e.ctrl && e.name === 'a') {
        setMode('add'); setFormField(0); setEditingEntry(null);
        setFormMnemonic(''); setFormName(''); setFormType(currentTypes[0]); setFormCommand('');
        setIsPlatformSpecific(false); setPlatformCommands([{ platform: 'default', cmd: '' }]);
      }
      if (e.name === 'escape') setMode('normal');
    } else if (mode === 'add' || mode === 'edit') {
      if (e.name === 'escape') { setMode('normal'); setEditingEntry(null); setFormMnemonic(''); setFormName(''); setFormType(''); setFormCommand(''); setIsPlatformSpecific(false); setPlatformCommands([{ platform: 'default', cmd: '' }]); return; }
      const baseFields = 4;
      const totalFields = isPlatformSpecific ? baseFields + (platformCommands.length * 2) : baseFields + 1;
      if (e.name === 'tab' || e.name === 'backtab') {
        if (e.shift || e.name === 'backtab') setFormField(f => (f - 1 + totalFields) % totalFields);
        else setFormField(f => (f + 1) % totalFields);
        return;
      }
      if (formField === 2) {
        if (e.name === 'space' || e.name === 'right' || e.name === 'down') { setFormType(prev => currentTypes[(currentTypes.indexOf(prev) + 1) % currentTypes.length]); return; }
        if (e.name === 'left' || e.name === 'up') { setFormType(prev => currentTypes[(currentTypes.indexOf(prev) - 1 + currentTypes.length) % currentTypes.length]); return; }
      }
      if (formField === 3 && (e.name === ' ' || e.name === 'enter' || e.name === 'return')) { setIsPlatformSpecific(v => !v); return; }
      if (isPlatformSpecific && formField >= 4) {
        if (e.ctrl && e.name === 'a') { setPlatformCommands(p => [...p, { platform: 'default', cmd: '' }]); return; }
        if (e.ctrl && e.name === 'x') {
          const idx = Math.floor((formField - 4) / 2);
          if (platformCommands.length > 1) { setPlatformCommands(p => p.filter((_, i) => i !== idx)); setFormField(prev => Math.max(4, prev - 2)); }
          return;
        }
      }
      if (e.name === 'enter' || e.name === 'return' || (e.ctrl && e.name === 's')) {
        const isCommandField = (!isPlatformSpecific && formField === 4) || (isPlatformSpecific && formField >= 4 && (formField - 4) % 2 === 1);

        if (!isCommandField || (e.ctrl && e.name === 's')) {
          if (mode === 'add') handleAdd();
          else handleSaveEdit();
          return;
        }
      }
    }
  });


  const colors = useMemo(() => ({
    fg: RGBA.defaultForeground(), bg: RGBA.defaultBackground(),
    magenta: RGBA.fromIndex(13), cyan: RGBA.fromIndex(14), yellow: RGBA.fromIndex(11),
    green: RGBA.fromIndex(10), blue: RGBA.fromIndex(12), white: RGBA.fromIndex(15),
    gray: RGBA.fromIndex(8), darkGray: RGBA.fromIndex(0), selection: RGBA.fromIndex(4),
  }), []);

  const itemHeight = 1;
  const basePadding = 9;
  const totalPadding = basePadding + (mode === 'search' ? 4 : 0) + (mode === 'navigate' ? 4 : 0) + ((mode === 'add' || mode === 'edit') ? (isPlatformSpecific ? 10 + platformCommands.length * 2 : 10) : 0) + (selectedEntry ? (typeof selectedEntry.node?.exec === 'object' ? 8 : 6) : 0) + ((mode === 'search' && searchFocus === 'list') ? 2 : 0);
  const availableHeight = height - totalPadding;
  const listHeightItems = Math.max(1, Math.floor(availableHeight / itemHeight));
  const startIdx = Math.max(0, Math.min(selectedIndex - Math.floor(listHeightItems / 2), Math.max(0, filteredEntries.length - listHeightItems)));

  const renderEntries = () => {
    return (
      <scrollbox style={{ flexGrow: 1, borderStyle: 'rounded' }} scrollTop={startIdx * itemHeight}>
        <box style={{ flexDirection: 'column' }}>
          {filteredEntries.map((entry: any, i) => {
            const isSelected = i === selectedIndex;
            if (viewMode === 'grouped' && !(mode === 'search' && searchQuery)) {
              const item = entry as GroupedItem;
              const indent = item.level * 2;
              const marker = item.hasChildren ? (item.isExpanded ? '▾' : '▸') : ' ';
              return (
                <box key={item.id} style={{ backgroundColor: isSelected ? colors.selection : undefined, flexDirection: 'row', height: itemHeight, paddingY: 0 }}>
                  <box style={{ height: 1, flexDirection: 'row', width: '100%', paddingLeft: indent }}>
                    <text style={{ width: 2, fg: colors.yellow }}>{marker}</text>
                    <text style={{ width: 20, fg: isSelected ? colors.white : (item.type === 'leaf' ? colors.green : colors.magenta) }}><b>{item.label}</b></text>
                    <text style={{ flexGrow: 1, fg: isSelected ? colors.white : colors.fg }}>{item.description || (item.entry?.description)}</text>
                    {item.type === 'leaf' && (<text style={{ width: 15, fg: colors.gray }}>[{item.entry?.mnemonic}]</text>)}
                  </box>
                </box>
              );
            }
            return (
              <box key={`${entry.category}-${entry.mnemonic}-${i}`} style={{ backgroundColor: isSelected ? colors.selection : undefined, flexDirection: 'row', height: itemHeight, paddingY: 0, justifyContent: 'space-between' }}>
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
    <box style={{ width, height, flexDirection: 'column', padding: 0, backgroundColor: colors.bg }}>
      <box style={{ height: 1, flexDirection: 'row', justifyContent: 'space-between', paddingX: 1, marginBottom: 0 }}>
        <box style={{ flexDirection: 'row' }}>
          <text style={{ fg: colors.magenta }}><b>{target.toUpperCase()} EXTEND </b></text>
          <text style={{ fg: colors.cyan }}>[{mode.toUpperCase()}]</text>
        </box>
        <text style={{ fg: colors.yellow }}>{filteredEntries.length} items</text>
      </box>
      {mode === 'search' && (
        <box style={{ height: 3, borderStyle: 'rounded', borderColor: searchFocus === 'input' ? colors.yellow : colors.darkGray, paddingX: 1, marginBottom: 0 }}>
          <input value={searchQuery} placeholder="Filter" focused={searchFocus === 'input'} onInput={setSearchQuery as any} />
        </box>
      )}
      {mode === 'navigate' && (
        <box style={{ height: 3, borderStyle: 'single', borderColor: colors.cyan, paddingX: 1, marginBottom: 1 }}>
          <text style={{ fg: colors.cyan }}>🧭 Go to: </text>
          <text style={{ fg: colors.white, bg: colors.blue }}><b> {navigateQuery} </b></text>
        </box>
      )}
      {(mode === 'add' || mode === 'edit') && (
        <box style={{ flexDirection: 'column', flexGrow: 1, borderStyle: 'rounded', borderColor: mode === 'add' ? colors.green : colors.yellow, padding: 0, marginBottom: 0 }}>
          <text style={{ fg: mode === 'add' ? colors.green : colors.yellow, marginBottom: 1 }}><b>{mode === 'add' ? 'ADD NEW ENTRY' : 'EDIT ENTRY'}</b></text>
          <box><text style={{ width: 12, fg: colors.green }}>Mnemonic: </text><input value={formMnemonic} focused={formField === 0} onInput={setFormMnemonic as any} /></box>
          <box><text style={{ width: 12, fg: colors.green }}>Full Name: </text><input value={formName} focused={formField === 1} onInput={setFormName as any} /></box>
          <box><text style={{ width: 12, fg: colors.green }}>Type: </text><text style={{ fg: formField === 2 ? colors.yellow : colors.fg }}> {formType} (Space/Arrows to change)</text></box>
          <box><text style={{ width: 12, fg: colors.green }}>Adv. OS: </text><text style={{ fg: formField === 3 ? colors.yellow : colors.fg }}>[{isPlatformSpecific ? 'X' : ' '}] Platform Specific (Space to toggle)</text></box>
          {!isPlatformSpecific ? (
            <box style={{ flexDirection: 'column' }}>
              <text style={{ width: 12, fg: colors.green }}>Command: </text>
              <box style={{ paddingLeft: 2, height: 6 }}>
                <textarea key={editingEntry ? `edit-${editingEntry.rootCategory}-${editingEntry.mnemonic}` : 'add'} initialValue={formCommand} ref={formCommandRef} focused={formField === 4} onContentChange={(e) => setFormCommand(formCommandRef.current.plainText)} onInput={setFormCommand as any} style={{ flexGrow: 1, backgroundColor: colors.selection } as any} />
              </box>
              <text style={{ fg: colors.gray, marginTop: 1 }}>[Ctrl+S] Save</text>
            </box>
          ) : (
            <box style={{ flexDirection: 'column' }}>
              {platformCommands.map((p, i) => (
                <box key={i} style={{ flexDirection: 'column', marginBottom: 1 }}>
                  <box style={{ marginBottom: 0 }}>
                    <text style={{ width: 4, fg: colors.blue }}> OS: </text>
                    <input value={p.platform} focused={formField === 4 + (i * 2)} onInput={((v: string) => { const next = [...platformCommands]; next[i].platform = v; setPlatformCommands(next); }) as any} style={{ width: 8 } as any} />
                    <text style={{ fg: colors.blue }}> Cmd: </text>
                  </box>
                  <box style={{ paddingLeft: 6, height: 4 }}>
                    <textarea key={editingEntry ? `edit-ps-${editingEntry.rootCategory}-${editingEntry.mnemonic}-${i}` : `add-ps-${i}`} initialValue={p.cmd} focused={formField === 5 + (i * 2)} onInput={((v: string) => { const next = [...platformCommands]; next[i].cmd = v; setPlatformCommands(next); }) as any} style={{ flexGrow: 1, backgroundColor: colors.selection } as any} />
                  </box>
                </box>
              ))}
              <text style={{ fg: colors.gray, marginLeft: 2 }}>[Ctrl+A] Add OS | [Ctrl+X] Remove OS | [Ctrl+S] Save</text>
            </box>
          )}
          <text style={{ fg: colors.gray, marginTop: 1 }}>[Tab/S-Tab] Cycle Fields | [Enter] Save | [Esc] Cancel</text>
        </box>
      )}
      {(mode !== 'add' && mode !== 'edit') && renderEntries()}
      {(mode !== 'add' && mode !== 'edit') && selectedEntry && (
        <box style={{ height: typeof selectedEntry.node?.exec === 'object' ? 7 : 5, borderStyle: 'rounded', borderColor: colors.gray, paddingX: 1, marginTop: 0, flexDirection: 'column' }}>
          <box><text style={{ fg: colors.white }}>{selectedEntry.cmd}</text></box>
          {typeof selectedEntry.node?.exec === 'object' && (
            <box style={{ flexDirection: 'column', marginTop: 0 }}>
              {Object.entries(selectedEntry.node.exec).map(([p, c]) => (<text key={p} style={{ fg: p === process.platform ? colors.green : colors.gray, height: 1 }}>• {p}: {c}</text>))}
            </box>
          )}
        </box>
      )}
      {false && (<box style={{ height: 3, borderStyle: 'rounded', borderColor: colors.gray, marginTop: 0, paddingX: 1 }}>
        <text style={{ fg: colors.gray }}>[j/k] Nav | [Enter] Run | [/] Filter | [g] Group | [h/l] Tree | [e] Edit | [d] Del | [a] Add | [s] Sync | [Ctrl+L] Debug | [q] Quit</text>
      </box>)}
      {showDebug && (
        <box style={{ position: 'absolute', bottom: 4, right: 2, width: 40, height: 12, borderStyle: 'single', borderColor: colors.magenta, backgroundColor: colors.bg, flexDirection: 'column', padding: 1 }}>
          <text style={{ fg: colors.magenta, marginBottom: 1 }}><b>DEBUG: KEY LOG</b></text>
          {keyHistory.map((k, i) => (<text key={i} style={{ fg: i === 0 ? colors.white : colors.gray, height: 1 }}>{k}</text>))}
        </box>
      )}
      {confirmDelete && (
        <box style={{ position: 'absolute', top: 'center', left: 'center', width: 50, height: 8, borderStyle: 'single', borderColor: colors.yellow, backgroundColor: colors.bg, flexDirection: 'column', padding: 1, justifyContent: 'center', alignItems: 'center' }}>
          <text style={{ fg: colors.yellow, marginBottom: 1 }}><b>CONFIRM DELETE</b></text>
          <text style={{ fg: colors.white, marginBottom: 1 }}>Delete entry: {confirmDelete.mnemonic}?</text>
          <text style={{ fg: colors.gray }}>[y] Yes | [n] No / Cancel</text>
        </box>
      )}
    </box>
  );
};
