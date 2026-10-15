import type { ChangeEntry, ScanPatch } from "./types";

export function changePathKey(path: string) {
  return path.replaceAll("/", "\\").replace(/[\\/]+$/, "").toLocaleLowerCase();
}

export function changePathIsWithin(path: string, directory: string) {
  const pathKey = changePathKey(path);
  const directoryKey = changePathKey(directory);
  return pathKey === directoryKey || pathKey.startsWith(`${directoryKey}\\`);
}

export function relativeChangePath(path: string, root: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized.toLocaleLowerCase() === normalizedRoot.toLocaleLowerCase()) return ".";
  const prefix = `${normalizedRoot}/`;
  return normalized.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? normalized.slice(prefix.length)
    : normalized;
}

export function refreshTargetsForDirectory(
  directory: string,
  scopeDirectories: readonly string[],
) {
  const containingScope = scopeDirectories.find((scope) => changePathIsWithin(directory, scope));
  return containingScope
    ? [directory]
    : scopeDirectories.filter((scope) => changePathIsWithin(scope, directory));
}

export function patchTouchesPath(patch: ScanPatch, path: string) {
  return patch.roots.some((root) => changePathIsWithin(path, root));
}

// 新目录提交后已成为版本化目录，需同时清除原先展开的目录和子项状态
export function refreshPathsForChanges(paths: string[], changes: readonly ChangeEntry[]) {
  const directories = changes.filter((change) => change.isDirectory && change.item === "unversioned");
  return paths.map((path) => {
    const ancestors = directories.filter((change) => changePathIsWithin(path, change.path));
    return ancestors.sort((left, right) => left.path.length - right.path.length)[0]?.path ?? path;
  });
}

export function mergeScanPatch(current: readonly ChangeEntry[], patch: ScanPatch) {
  const merged = new Map<string, ChangeEntry>();
  for (const change of current) {
    if (!patchTouchesPath(patch, change.path)) {
      merged.set(changePathKey(change.path), change);
    }
  }
  for (const change of patch.changes) {
    merged.set(changePathKey(change.path), change);
  }
  return [...merged.values()].sort((left, right) => left.relativePath.localeCompare(
    right.relativePath,
    "zh-CN",
    { sensitivity: "base" },
  ));
}

// 并行核对时保留后来启动的刷新结果，防止慢目录扫描恢复已提交的旧状态
export class ScanPatchTracker {
  private nextId = 0;
  private active = new Set<number>();
  private completed = new Map<number, ScanPatch>();

  begin() {
    const id = ++this.nextId;
    this.active.add(id);
    return id;
  }

  clear() {
    this.active.clear();
    this.completed.clear();
  }

  finish(id: number, patch: ScanPatch) {
    if (!this.active.has(id)) return undefined;
    let changes = patch.changes;
    for (const [newerId, newer] of [...this.completed].sort(([left], [right]) => left - right)) {
      if (newerId <= id) continue;
      changes = mergeScanPatch(changes, {
        roots: newer.roots,
        changes: newer.changes.filter((change) => patchTouchesPath(patch, change.path)),
      });
    }
    const updated = { ...patch, changes };
    this.completed.set(id, updated);
    this.cancel(id);
    return updated;
  }

  cancel(id: number) {
    this.active.delete(id);
    const oldest = Math.min(...this.active);
    for (const key of this.completed.keys()) {
      if (key < oldest) this.completed.delete(key);
    }
  }
}
