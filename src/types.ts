export interface ChangeEntry {
  path: string;
  relativePath: string;
  name: string;
  item: string;
  properties: string;
  statusCode: string;
  isDirectory: boolean;
  treeConflicted: boolean;
}

export interface ToolAvailability {
  available: boolean;
  path: string | null;
}

export interface ScanResult {
  directory: string;
  wcRoot: string;
  repositoryUrl: string | null;
  revision: string | null;
  svnVersion: string;
  changes: ChangeEntry[];
  beyondCompare: ToolAvailability;
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
  propertyDiff: string | null;
}

export interface TreeNode {
  key: string;
  name: string;
  isFolder: boolean;
  children: TreeNode[];
  change?: ChangeEntry;
}
