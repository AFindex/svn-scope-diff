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
  contextOnly?: boolean;
}

export interface ToolAvailability {
  available: boolean;
  path: string | null;
}

export interface TortoiseSvnAvailability extends ToolAvailability {
  autoSelectFiles: boolean;
  showUnversioned: boolean;
}

export interface CommitLaunchResult {
  selectedCount: number;
  message: string;
}

export interface SvnUpdateStatus {
  running: boolean;
  updateId: number | null;
  pid: number | null;
  directories: string[];
  cancelRequested: boolean;
}

export interface SvnUpdateFinished {
  updateId: number;
  directories: string[];
  outcome: "success" | "cancelled" | "failed";
  exitCode: number | null;
  forced: boolean;
  message: string;
}

export interface ScanResult {
  directory: string;
  scopeDirectories: string[];
  wcRoot: string;
  revision: string | null;
  svnVersion: string;
  changes: ChangeEntry[];
}

export interface ScanPatch {
  roots: string[];
  changes: ChangeEntry[];
}

export interface WorkingCopyWatcherStatus {
  watcherId: number | null;
  directories: string[];
}

export interface WorkingCopyChanged {
  watcherId: number;
  paths: string[];
}

export interface WorkingCopyWatchError {
  watcherId: number;
  message: string;
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
  selectableChanges: ChangeEntry[];
  conflictCount: number;
  change?: ChangeEntry;
}
