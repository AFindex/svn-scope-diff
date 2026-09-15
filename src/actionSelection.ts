import type { ChangeEntry } from "./types";

export interface ActionSelectionModifiers {
  toggle: boolean;
  range: boolean;
}

export interface ActionSelectionResult {
  selectedPaths: Set<string>;
  anchorPath: string;
}

export function actionPathKey(path: string) {
  return path.replaceAll("/", "\\").replace(/[\\/]+$/, "").toLowerCase();
}

export function reconcileActionSelection(
  selectedPaths: ReadonlySet<string>,
  changes: readonly ChangeEntry[],
) {
  const available = new Set(changes.map((change) => actionPathKey(change.path)));
  return new Set([...selectedPaths].filter((key) => available.has(key)));
}

export function selectedActionChanges(
  changes: readonly ChangeEntry[],
  selectedPaths: ReadonlySet<string>,
) {
  return changes.filter((change) => selectedPaths.has(actionPathKey(change.path)));
}

export function updateActionSelection(
  selectedPaths: ReadonlySet<string>,
  clicked: ChangeEntry,
  orderedChanges: readonly ChangeEntry[],
  anchorPath: string | undefined,
  modifiers: ActionSelectionModifiers,
): ActionSelectionResult {
  const clickedKey = actionPathKey(clicked.path);
  const next = modifiers.toggle ? new Set(selectedPaths) : new Set<string>();

  if (modifiers.range && anchorPath) {
    const anchorKey = actionPathKey(anchorPath);
    const anchorIndex = orderedChanges.findIndex(
      (change) => actionPathKey(change.path) === anchorKey,
    );
    const clickedIndex = orderedChanges.findIndex(
      (change) => actionPathKey(change.path) === clickedKey,
    );
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      for (const change of orderedChanges.slice(start, end + 1)) {
        next.add(actionPathKey(change.path));
      }
      return { selectedPaths: next, anchorPath };
    }
  }

  if (modifiers.toggle && next.has(clickedKey)) next.delete(clickedKey);
  else next.add(clickedKey);
  return { selectedPaths: next, anchorPath: clicked.path };
}
