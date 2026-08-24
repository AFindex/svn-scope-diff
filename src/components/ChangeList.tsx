import { useMemo } from "react";
import { directoryOf, extensionLabel, extensionOf } from "../changeFilters";
import { displayStatusCode } from "../status";
import type { ChangeEntry } from "../types";
import { Icon } from "./Icons";

export type ChangeListSortKey = "path" | "name" | "directory" | "status" | "extension";
export type SortDirection = "asc" | "desc";

interface ChangeListProps {
  changes: ChangeEntry[];
  totalCount: number;
  emptyMessage: string;
  selectedPath?: string;
  sortKey: ChangeListSortKey;
  direction: SortDirection;
  onSelect: (change: ChangeEntry) => void;
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
  sortKey,
  direction,
  onSelect,
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
        return (
          <button
            key={change.path}
            type="button"
            role="listitem"
            className={`change-list-row ${change.path === selectedPath ? "selected" : ""}`}
            title={`${change.relativePath} · ${change.item}`}
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
            <span className="list-extension">{extension}</span>
          </button>
        );
      })}
    </div>
  );
}
