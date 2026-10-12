import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEntry } from "../types";
import { Icon } from "./Icons";

const statusLabels: Record<string, string> = {
  M: "修改", A: "新增", D: "删除", R: "替换", C: "冲突",
  "!": "丢失", "?": "未版本化", "~": "阻塞", G: "合并",
};

interface StatusFilterSelectProps {
  changes: ChangeEntry[];
  selectedValues: readonly string[];
  onChange: (values: string[]) => void;
}

export function StatusFilterSelect({ changes, selectedValues, onChange }: StatusFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const summary = selectedValues.length
    ? selectedValues.map((code) => statusLabels[code]).join("、")
    : "全部状态";
  const counts = changes.reduce<Record<string, number>>((result, change) => {
    const code = change.treeConflicted || change.properties === "conflicted" ? "C" : change.statusCode;
    result[code] = (result[code] ?? 0) + 1;
    return result;
  }, {});
  const selectedCount = selectedValues.length
    ? selectedValues.reduce((count, code) => count + (counts[code] ?? 0), 0)
    : changes.length;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`type-filter-multiselect status-filter-select ${open ? "open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="type-filter-trigger"
        aria-label={`修改状态筛选：${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title={summary}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="filter" size={14} />
        <span>{summary}</span><b>{selectedCount}</b>
        <Icon name="chevron" size={13} className="type-filter-chevron" />
      </button>
      {open && (
        <div id={panelId} className="type-filter-dropdown" role="dialog" aria-label="选择修改状态">
          <div className="type-filter-actions">
            <span>修改状态 · 可多选</span>
            <button type="button" disabled={!selectedValues.length} onClick={() => onChange([])}>全部状态</button>
          </div>
          <div className="type-filter-options" role="group" aria-label="可选修改状态">
            {Object.entries(statusLabels).map(([code, label]) => (
              <label key={code} className={`type-filter-option ${selectedValues.includes(code) ? "selected" : ""}`}>
                <input type="checkbox" checked={selectedValues.includes(code)} onChange={(event) => onChange(
                  event.target.checked ? [...selectedValues, code] : selectedValues.filter((value) => value !== code),
                )} />
                <span className="type-filter-checkmark" aria-hidden="true" />
                <span className="type-filter-option-name">{label}</span>
                <span className="type-filter-option-count">{counts[code] ?? 0}</span>
              </label>
            ))}
          </div>
          <div className="type-filter-footer" aria-live="polite">{selectedValues.length ? `已选 ${selectedValues.length} 种状态` : "未限定状态"}，共 {selectedCount} 项修改</div>
        </div>
      )}
    </div>
  );
}
