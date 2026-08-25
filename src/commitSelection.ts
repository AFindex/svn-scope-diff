import type { ChangeEntry } from "./types";

export function commitPathKey(path: string) {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase();
}

export function isCommitPathWithin(path: string, directory: string) {
  const pathKey = commitPathKey(path);
  const directoryKey = commitPathKey(directory);
  return pathKey === directoryKey || pathKey.startsWith(`${directoryKey}\\`);
}

export function isCommitSelectable(change: ChangeEntry) {
  return !(change.isDirectory && change.item === "unversioned");
}

export function expandCommitSelectionKeys(
  changes: ChangeEntry[],
  requested: ChangeEntry[],
) {
  const expanded = new Set<string>();

  for (const target of requested) {
    if (!isCommitSelectable(target)) continue;
    expanded.add(commitPathKey(target.path));

    if (!target.isDirectory) continue;
    for (const candidate of changes) {
      if (
        isCommitSelectable(candidate)
        && isCommitPathWithin(candidate.path, target.path)
      ) {
        expanded.add(commitPathKey(candidate.path));
      }
    }
  }

  return expanded;
}

export function reconcileCommitSelection(
  selectedKeys: ReadonlySet<string>,
  changes: ChangeEntry[],
) {
  const retained = changes.filter(
    (change) => (
      isCommitSelectable(change)
      && selectedKeys.has(commitPathKey(change.path))
    ),
  );
  return expandCommitSelectionKeys(changes, retained);
}

export function ancestorDirectorySelectionKeys(
  changes: ChangeEntry[],
  targets: ChangeEntry[],
) {
  return new Set(
    changes
      .filter((change) => (
        change.isDirectory
        && isCommitSelectable(change)
        && targets.some((target) => isCommitPathWithin(target.path, change.path))
      ))
      .map((change) => commitPathKey(change.path)),
  );
}

export function selectedCommitChanges(
  changes: ChangeEntry[],
  selectedKeys: ReadonlySet<string>,
) {
  return changes.filter(
    (change) => isCommitSelectable(change) && selectedKeys.has(commitPathKey(change.path)),
  );
}
