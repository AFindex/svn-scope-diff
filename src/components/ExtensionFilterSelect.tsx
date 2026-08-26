import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ALL_FILE_TYPES, type FileTypeOption } from "../changeFilters";
import { Icon } from "./Icons";

interface ExtensionFilterSelectProps {
  options: FileTypeOption[];
  selectedValues: readonly string[];
  totalCount: number;
  onChange: (values: string[]) => void;
}

export function ExtensionFilterSelect({
  options,
  selectedValues,
  totalCount,
  onChange,
}: ExtensionFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const allSelected = selectedValues.includes(ALL_FILE_TYPES);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedOptions = allSelected
    ? options
    : options.filter((option) => selectedSet.has(option.value));
  const selectedCount = selectedOptions.length;
  const selectedChangeCount = selectedOptions.reduce((count, option) => count + option.count, 0);
  const summary = allSelected
    ? "全部类型"
    : selectedCount === 0
      ? "未选择后缀"
      : selectedCount === 1
        ? selectedOptions[0].label
        : `已选 ${selectedCount} 种后缀`;
  const selectionTitle = allSelected
    ? `全部类型（${totalCount} 项修改）`
    : selectedCount
      ? selectedOptions.map((option) => option.label).join("、")
      : "未选择任何后缀";

  useEffect(() => {
    if (!open) return undefined;

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

  const toggleOption = (value: string, checked: boolean) => {
    const nextSet = allSelected
      ? new Set(options.map((option) => option.value))
      : new Set(selectedValues);

    if (checked) nextSet.add(value);
    else nextSet.delete(value);

    const nextValues = options
      .map((option) => option.value)
      .filter((optionValue) => nextSet.has(optionValue));
    onChange(nextValues.length === options.length && options.length
      ? [ALL_FILE_TYPES]
      : nextValues);
  };

  return (
    <div
      ref={containerRef}
      className={`type-filter-multiselect ${open ? "open" : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="type-filter-trigger"
        aria-label={`按文件后缀筛选：${selectionTitle}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title={selectionTitle}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="file" size={14} />
        <span>{summary}</span>
        <b>{allSelected ? totalCount : selectedChangeCount}</b>
        <Icon name="chevron" size={13} className="type-filter-chevron" />
      </button>

      {open && (
        <div
          id={panelId}
          className="type-filter-dropdown"
          role="dialog"
          aria-label="选择文件后缀"
        >
          <div className="type-filter-actions">
            <span>文件后缀</span>
            <button
              type="button"
              disabled={allSelected}
              onClick={() => onChange([ALL_FILE_TYPES])}
            >
              全选
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => onChange([])}
            >
              清除选择
            </button>
          </div>

          <div className="type-filter-options" role="group" aria-label="可选文件后缀">
            {options.map((option) => {
              const checked = allSelected || selectedSet.has(option.value);
              return (
                <label
                  key={option.value}
                  className={`type-filter-option ${checked ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleOption(option.value, event.target.checked)}
                  />
                  <span className="type-filter-checkmark" aria-hidden="true" />
                  <span className="type-filter-option-name">{option.label}</span>
                  <span className="type-filter-option-count">{option.count}</span>
                </label>
              );
            })}
          </div>

          <div className="type-filter-footer" aria-live="polite">
            已选择 {selectedCount}/{options.length} 种，共 {allSelected ? totalCount : selectedChangeCount} 项修改
          </div>
        </div>
      )}
    </div>
  );
}
