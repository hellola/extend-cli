export interface Node {
  description?: string;
  type?: string;
  exec?: string | { [platform: string]: string };
  children?: { [key: string]: Node };
  bundle?: string; // Path to a bundle file to load at this node
  category?: string;
  tableName?: string;
  tableDescription?: string;
  _source?: string;
}

export interface TableBind {
  key: string;
  table?: string;
  bundle?: string;
  type?: 'exec' | 'send' | 'run' | 'test' | 'function' | 'alias' | 'export';
  action?: string | { [platform: string]: string };
  description?: string;
  category?: string;
  mount?: boolean;
  dependency?: string;
}

export interface TableDef {
  binds: TableBind[];
  modal?: boolean;
  mount?: boolean;
  description?: string;
}

export interface TableEntry {
  [tableName: string]: TableDef;
}

export type TableSource = TableEntry[];

export interface Tree {
  [category: string]: { [key: string]: Node };
}

export interface Entry {
  type: 'alias' | 'func' | 'export';
  mnemonic: string;
  name: string;
  cmd: string;
  comment: string;
  category: string;
  rootCategory: string;
  description: string;
  source?: string; // Track which file it came from
  node?: Node;
}

export interface GroupedItem {
  id: string;
  level: number;
  type: 'category' | 'table' | 'leaf';
  label: string;
  description?: string;
  isExpanded: boolean;
  hasChildren: boolean;
  entry?: Entry;
  node?: Node;
}

export interface ConfigStrategy {
    id: string;
    mnemonicSeparator: string;
    getMnemonic(parent: string, key: string): string;
    getEntryName(mnemonic: string, slugParts: string[]): string;
    splitMnemonic(mnemonic: string): string[];
    render(tree: Tree): string;
    sync(): void;
    getSourceCommand(outputPath: string): string;
}

