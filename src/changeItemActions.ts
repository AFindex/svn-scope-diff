import type { ChangeEntry } from "./types";

export type ChangeItemAction =
  | "refresh"
  | "open"
  | "reveal"
  | "copyRelativePath"
  | "copyFullPath"
  | "commit"
  | "revert"
  | "blame"
  | "showLog"
  | "conflictEditor"
  | "resolve";

export interface ChangeActionCapabilities {
  canOpen: boolean;
  canCommit: boolean;
  canRevert: boolean;
  canBlame: boolean;
  canShowLog: boolean;
  canConflictEditor: boolean;
  canResolve: boolean;
}

export function isConflictedChange(change: ChangeEntry) {
  return change.statusCode === "C"
    || change.item === "conflicted"
    || change.properties === "conflicted"
    || change.treeConflicted;
}

export function conflictKinds(change: ChangeEntry) {
  const kinds: string[] = [];
  if (change.item === "conflicted") kinds.push("文本冲突");
  if (change.properties === "conflicted") kinds.push("属性冲突");
  if (change.treeConflicted) kinds.push("树冲突");
  if (!kinds.length && change.statusCode === "C") kinds.push("冲突");
  return kinds;
}

export function conflictLabel(change: ChangeEntry) {
  return conflictKinds(change).join(" + ");
}

export function countConflictBlocks(content: string) {
  return content.match(/^<{7}(?:\s|$)/gm)?.length ?? 0;
}

export function changeActionCapabilities(
  change: ChangeEntry,
  tortoiseAvailable: boolean,
): ChangeActionCapabilities {
  const conflicted = isConflictedChange(change);
  const versioned = change.item !== "unversioned";
  const hasRepositoryHistory = versioned
    && change.baseRevision !== null
    && !["added", "obstructed", "incomplete"].includes(change.item);
  const canBlameWorkingFile = hasRepositoryHistory
    && !["deleted", "missing"].includes(change.item);

  return {
    canOpen: !["deleted", "missing"].includes(change.item),
    canCommit: tortoiseAvailable
      && !change.contextOnly
      && !(change.item === "unversioned" && change.isDirectory)
      && !conflicted,
    canRevert: tortoiseAvailable && versioned && !change.contextOnly,
    canBlame: tortoiseAvailable && !change.isDirectory && canBlameWorkingFile,
    canShowLog: tortoiseAvailable && hasRepositoryHistory,
    canConflictEditor: tortoiseAvailable
      && conflicted
      && !change.isDirectory
      && change.item === "conflicted",
    canResolve: tortoiseAvailable && conflicted,
  };
}
