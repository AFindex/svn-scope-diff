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
