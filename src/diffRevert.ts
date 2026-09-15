export interface DiffLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export type DiffSelectionSide = "original" | "modified";

export interface DiffLineSelection {
  side: DiffSelectionSide;
  startLineNumber: number;
  endLineNumber: number;
}

function intersectsSelection(change: DiffLineChange, selection: DiffLineSelection) {
  const start = selection.side === "original"
    ? change.originalStartLineNumber
    : change.modifiedStartLineNumber;
  const end = selection.side === "original"
    ? change.originalEndLineNumber
    : change.modifiedEndLineNumber;
  if (end === 0) return false;
  return start <= selection.endLineNumber && end >= selection.startLineNumber;
}

export function selectedDiffChanges(
  changes: readonly DiffLineChange[],
  selection: DiffLineSelection | undefined,
) {
  if (!selection) return [];
  return changes.filter((change) => intersectsSelection(change, selection));
}

export function revertSelectedDiffChanges(
  original: string,
  modified: string,
  changes: readonly DiffLineChange[],
  selection: DiffLineSelection,
) {
  const selected = selectedDiffChanges(changes, selection);
  if (!selected.length) return undefined;

  const eol = modified.includes("\r\n") || (!modified.includes("\n") && original.includes("\r\n"))
    ? "\r\n"
    : "\n";
  const originalLines = original ? original.split(/\r?\n/) : [];
  const modifiedLines = modified ? modified.split(/\r?\n/) : [];
  const edits = selected.map((change) => ({
    spliceIndex: change.modifiedEndLineNumber === 0
      ? change.modifiedStartLineNumber
      : Math.max(0, change.modifiedStartLineNumber - 1),
    deleteCount: change.modifiedEndLineNumber === 0
      ? 0
      : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1,
    replacement: change.originalEndLineNumber === 0
      ? []
      : originalLines.slice(
        Math.max(0, change.originalStartLineNumber - 1),
        change.originalEndLineNumber,
      ),
  })).sort((left, right) => right.spliceIndex - left.spliceIndex);

  for (const edit of edits) {
    modifiedLines.splice(edit.spliceIndex, edit.deleteCount, ...edit.replacement);
  }

  return {
    content: modifiedLines.join(eol),
    hunkCount: selected.length,
  };
}
