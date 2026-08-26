import { useMemo } from "react";
import { directoryOf, extensionLabel, extensionOf } from "../changeFilters";
import { conflictLabel, isConflictedChange } from "../changeItemActions";
import { commitPathKey, isCommitSelectable } from "../commitSelection";
import { displayStatusCode } from "../status";
import type { ChangeEntry } from "../types";
import { Icon } from "./Icons";
import { SelectionCheckbox } from "./SelectionCheckbox";

export type ChangeListSortKey = "path" | "name" | "directory" | "status" | "extension";
export type SortDirection = "asc" | "desc";

interface ChangeListProps {
  changes: ChangeEntry[];
  totalCount: number;
  emptyMessage: string;
  selectedPath?: string;
  selectedCommitPaths: ReadonlySet<string>;
  sortKey: ChangeListSortKey;
  direction: SortDirection;
  onSelect: (change: ChangeEntry) => void;
  onToggleCommitSelection: (changes: ChangeEntry[], checked: boolean) => void;
  onOpenContextMenu: (
    change: ChangeEntry,
    x: number,
    y: number,
    returnFocus?: HTMLElement,
  ) => void;
}

const statusOrder: Record<string, number> = {
  C: 0,
  "!": 1,
  "~": 2,
  M: 3,
  R: 4,
  A: 5,
  D: 6,
  "?": 7,
  G: 8,
};

export function ChangeList({
  changes,
  totalCount,
  emptyMessage,
  selectedPath,
  selectedCommitPaths,
  sortKey,
  direction,
  onSelect,
  onToggleCommitSelection,
  onOpenContextMenu,
}: ChangeListProps) {
  const rows = useMemo(() => {
    const sorted = [...changes];
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

    sorted.sort((left, right) => {
      let comparison = 0;
      if (sortKey === "name") comparison = collator.compare(left.name, right.name);
      else if (sortKey === "directory") comparison = collator.compare(directoryOf(left), directoryOf(right));
      else if (sortKey === "status") {
        comparison = (statusOrder[left.statusCode] ?? 99) - (statusOrder[right.statusCode] ?? 99);
      } else if (sortKey === "extension") {
        comparison = collator.compare(extensionLabel(extensionOf(left)), extensionLabel(extensionOf(right)));
      } else comparison = collator.compare(left.relativePath, right.relativePath);

      if (comparison === 0) comparison = collator.compare(left.relativePath, right.relativePath);
      return direction === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [changes, direction, sortKey]);

  if (!rows.length && totalCount) {
    return <div className="tree-no-results">{emptyMessage}</div>;
  }

  return (
    <div className="change-list" role="list" aria-label="本地修改列表">
      {rows.map((change) => {
        const directory = directoryOf(change);
        const extension = extensionLabel(extensionOf(change));
        const commitSelectable = isCommitSelectable(change);
        const commitSelected = selectedCommitPaths.has(commitPathKey(change.path));
        const conflicted = isConflictedChange(change);
        return (
          <div
            key={change.path}
            role="listitem"
            className={`change-list-row ${change.path === selectedPath ? "selected" : ""} ${commitSelected ? "commit-selected" : ""} ${conflicted ? "conflicted" : ""}`}
            title={`${change.relativePath} · ${change.item}`}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(change);
              const bounds = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(
                change,
                event.clientX || bounds.left + 32,
                event.clientY || bounds.bottom,
                event.currentTarget.querySelector<HTMLButtonElement>(".change-list-open") ?? undefined,
              );
            }}
          >
            <SelectionCheckbox
              state={commitSelected ? "all" : "none"}
              disabled={!commitSelectable}
              label={`选择提交 ${change.relativePath}`}
              title={commitSelectable
                ? `将 ${change.relativePath} 加入提交选择`
                : "未版本化目录不会直接转交，避免 TortoiseSVN 递归加入未知文件"}
              onChange={(checked) => onToggleCommitSelection([change], checked)}
            />
            <button
              type="button"
              className="change-list-open"
              onClick={() => onSelect(change)}
            >
              <span className="status-badge" data-status={change.statusCode}>
                {displayStatusCode(change.statusCode)}
              </span>
              <span className={`list-kind ${change.isDirectory ? "folder" : "file"}`}>
                <Icon name={change.isDirectory ? "folder" : "file"} size={16} />
              </span>
              <span className="list-file-info">
                <span className="list-file-name">{change.name}</span>
                <span className="list-file-path">{directory === "." ? change.relativePath : directory}</span>
              </span>
              {conflicted && (
                <span className="list-conflict-indicator" title={conflictLabel(change)}>
                  <Icon name="conflict" size={12} />
                  冲突
                </span>
              )}
              <span className="list-extension">{extension}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
