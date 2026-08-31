import type { ChangeEntry, ScanPatch } from "./types";

export function changePathKey(path: string) {
  return path.replaceAll("/", "\\").replace(/[\\/]+$/, "").toLocaleLowerCase();
}

export function changePathIsWithin(path: string, directory: string) {
  const pathKey = changePathKey(path);
  const directoryKey = changePathKey(directory);
  return pathKey === directoryKey || pathKey.startsWith(`${directoryKey}\\`);
}

export function patchTouchesPath(patch: ScanPatch, path: string) {
  return patch.roots.some((root) => changePathIsWithin(path, root));
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
