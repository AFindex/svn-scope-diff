export interface ChangeEntry {
  path: string;
  relativePath: string;
  name: string;
  item: string;
  properties: string;
  statusCode: string;
  isDirectory: boolean;
  treeConflicted: boolean;
  baseRevision: string | null;
}

export interface ToolAvailability {
  available: boolean;
  path: string | null;
}

export interface ScanResult {
  directory: string;
  wcRoot: string;
  revision: string | null;
  svnVersion: string;
  changes: ChangeEntry[];
}

export interface DiffResult {
  path: string;
  original: string;
  modified: string;
  originalLabel: string;
  modifiedLabel: string;
  originalEncoding: string;
  modifiedEncoding: string;
  originalBytes: number;
  modifiedBytes: number;
  isBinary: boolean;
  isDirectory: boolean;
  truncated: boolean;
  note: string | null;
}

export interface FileFingerprint {
  exists: boolean;
  isDirectory: boolean;
  size: number;
  modifiedNs: string | null;
}

export interface TreeNode {
  key: string;
  name: string;
  isFolder: boolean;
  children: TreeNode[];
  change?: ChangeEntry;
}
