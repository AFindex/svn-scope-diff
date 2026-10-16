import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DIRECTORY_FILE_TYPE, NO_EXTENSION_FILE_TYPE, fileTypeOptions } from "../changeFilters";
import { TEXT_DIFF_EXTENSIONS, normalizeTextDiffExtensions } from "../textDiffFiles";
import type { ChangeEntry } from "../types";
import { Icon } from "./Icons";

interface TextDiffUpdateProps {
  changes: ChangeEntry[];
  extensions: string[];
  count: number;
  progress?: { completed: number; total: number };
  disabled: boolean;
  onExtensionsChange: (extensions: string[]) => void;
  onUpdate: () => void;
}

export function TextDiffUpdate({ changes, extensions, count, progress, disabled, onExtensionsChange, onUpdate }: TextDiffUpdateProps) {
  const [open, setOpen] = useState(false);
  const [extensionText, setExtensionText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const options = useMemo(() => {
    const counts = new Map(fileTypeOptions(changes).map((option) => [option.value, option.count]));
    const values = new Set<string>([...TEXT_DIFF_EXTENSIONS, ...extensions, ...counts.keys()]);
    values.delete(DIRECTORY_FILE_TYPE);
    values.delete(NO_EXTENSION_FILE_TYPE);
    return [...values].sort().map((extension) => ({ extension, count: counts.get(extension) ?? 0 }));
  }, [changes, extensions]);
  const selectedSet = new Set(extensions);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const addExtensions = () => {
    onExtensionsChange([...new Set([...extensions, ...normalizeTextDiffExtensions(extensionText)])]);
    setExtensionText("");
  };

  return <div className="text-diff-update" ref={containerRef}>
    <button type="button" className="toolbar-button" ref={triggerRef}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId}
      title="选择格式并更新 SVN 文本 Diff；打开菜单不会立即开始扫描"
      onClick={() => setOpen(!open)}>
      <Icon name="refresh" size={15} className={progress ? "rotating" : undefined} />
      {progress ? `SVN Diff ${progress.completed}/${progress.total}` : "SVN 文本 Diff"}
      <Icon name="chevron" size={12} />
    </button>
    {open && <div className="text-diff-update-panel" role="dialog" aria-label="更新 SVN 文本 Diff" id={panelId}>
      <strong>更新 SVN 文本 Diff</strong>
      <p>核对所选格式的 SVN 状态并更新差异缓存，不受左侧列表筛选影响。不会执行 SVN Update、提交或回退。</p>
      <fieldset disabled={Boolean(progress)}>
        <legend className="visually-hidden">SVN 文本 Diff 格式</legend>
        <div className="type-filter-actions">
          <span>格式白名单 · 已选 {extensions.length} 种</span>
          <button type="button" onClick={() => onExtensionsChange([...TEXT_DIFF_EXTENSIONS])}>恢复默认</button>
          <button type="button" onClick={() => onExtensionsChange([])}>清空</button>
        </div>
        <div className="type-filter-options" role="group" aria-label="SVN Diff 可选格式">
          {options.map(({ extension, count: fileCount }) => <label key={extension}
            className={`type-filter-option ${selectedSet.has(extension) ? "selected" : ""}`}>
            <input type="checkbox" checked={selectedSet.has(extension)}
              onChange={(event) => onExtensionsChange(event.target.checked
                ? [...extensions, extension] : extensions.filter((current) => current !== extension))} />
            <span className="type-filter-checkmark" aria-hidden="true" />
            <span className="type-filter-option-name">.{extension}</span>
            <span className="type-filter-option-count">{fileCount}</span>
          </label>)}
        </div>
        <div className="text-diff-custom-format">
          <input aria-label="添加自定义 SVN Diff 格式" placeholder="自定义后缀，如 .asmdef .txt"
            value={extensionText} onChange={(event) => setExtensionText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addExtensions(); } }} />
          <button type="button" className="toolbar-button" disabled={!normalizeTextDiffExtensions(extensionText).length}
            onClick={addExtensions}>添加</button>
        </div>
      </fieldset>
      <div className="text-diff-update-footer">
        <span>格式选择自动保存 · 匹配 {count} 个文件</span>
        <button type="button" className="bulk-diff-button" disabled={disabled || Boolean(progress) || !count} onClick={onUpdate}>
          <Icon name="refresh" size={14} className={progress ? "rotating" : undefined} />
          <span>{progress ? "正在更新 SVN 文本 Diff" : "更新 SVN 文本 Diff"}</span>
          <b aria-live="polite">{progress ? `${progress.completed}/${progress.total}` : count}</b>
        </button>
      </div>
    </div>}
  </div>;
}
