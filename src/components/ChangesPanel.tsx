import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ALL_FILE_TYPES,
  fileTypeOptions,
  filterChanges,
  type ListFilterMode,
} from "../changeFilters";
import {
  commitPathKey,
  isCommitSelectable,
  selectedCommitChanges,
} from "../commitSelection";
import type { ChangeItemAction } from "../changeItemActions";
import { displayStatusCode } from "../status";
import type { ChangeEntry, TortoiseSvnAvailability } from "../types";
import { ChangeList, type ChangeListSortKey, type SortDirection } from "./ChangeList";
import { ChangeContextMenu } from "./ChangeContextMenu";
import { ChangeTree } from "./ChangeTree";
import { ExtensionFilterSelect } from "./ExtensionFilterSelect";
import { Icon } from "./Icons";

interface ChangesPanelProps {
  directory: string;
  changes: ChangeEntry[];
  selectedPath?: string;
  selectedCommitPaths: ReadonlySet<string>;
  tortoiseSvn?: TortoiseSvnAvailability;
  commitLaunching: boolean;
  workspaceUpdating: boolean;
  textDiffCount: number;
  bulkDiffProgress?: {
    completed: number;
    total: number;
  };
  onSelect: (change: ChangeEntry) => void;
  onToggleCommitSelection: (changes: ChangeEntry[], checked: boolean) => void;
  onClearCommitSelection: () => void;
  onCommitSelection: () => void;
  onUpdateAllTextDiffs: () => void;
  onItemAction: (action: ChangeItemAction, change: ChangeEntry) => void;
}

function statusCounts(changes: ChangeEntry[]) {
  return changes.reduce<Record<string, number>>((counts, change) => {
    counts[change.statusCode] = (counts[change.statusCode] ?? 0) + 1;
    return counts;
  }, {});
}

interface SearchFieldProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
}

function SearchField({ value, placeholder, ariaLabel, className = "", onChange }: SearchFieldProps) {
  return (
    <label className={`search-box ${className}`.trim()}>
      <Icon name="search" size={15} />
      <input
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="清除筛选">
          <Icon name="close" size={13} />
        </button>
      )}
    </label>
  );
}

export function ChangesPanel({
  directory,
  changes,
  selectedPath,
  selectedCommitPaths,
  tortoiseSvn,
  commitLaunching,
  workspaceUpdating,
  textDiffCount,
  bulkDiffProgress,
  onSelect,
  onToggleCommitSelection,
  onClearCommitSelection,
  onCommitSelection,
  onUpdateAllTextDiffs,
  onItemAction,
}: ChangesPanelProps) {
  const [treeQuery, setTreeQuery] = useState("");
  const [changeView, setChangeView] = useState<"tree" | "list">("tree");
  const [listSortKey, setListSortKey] = useState<ChangeListSortKey>("path");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [listFilterMode, setListFilterMode] = useState<ListFilterMode>("text");
  const [listTextFilter, setListTextFilter] = useState("");
  const [listExtensionFilters, setListExtensionFilters] = useState<string[]>([ALL_FILE_TYPES]);
  const [contextMenu, setContextMenu] = useState<{
    change: ChangeEntry;
    x: number;
    y: number;
    returnFocus?: HTMLElement;
  }>();
  const counts = useMemo(() => statusCounts(changes), [changes]);
  const typeOptions = useMemo(() => fileTypeOptions(changes), [changes]);
  const filteredListChanges = useMemo(
    () => filterChanges(changes, listFilterMode, listTextFilter, listExtensionFilters),
    [changes, listExtensionFilters, listFilterMode, listTextFilter],
  );
  const filteredTreeChanges = useMemo(() => {
    const normalized = treeQuery.trim().toLocaleLowerCase();
    if (!normalized) return changes;
    return changes.filter((change) => change.relativePath.toLocaleLowerCase().includes(normalized));
  }, [changes, treeQuery]);
  const visibleChanges = changeView === "tree" ? filteredTreeChanges : filteredListChanges;
  const visibleCommitChanges = useMemo(
    () => visibleChanges.filter(isCommitSelectable),
    [visibleChanges],
  );
  const commitChanges = useMemo(
    () => selectedCommitChanges(changes, selectedCommitPaths),
    [changes, selectedCommitPaths],
  );
  const allVisibleSelected = Boolean(visibleCommitChanges.length) && visibleCommitChanges.every(
    (change) => selectedCommitPaths.has(commitPathKey(change.path)),
  );
  const selectedDirectoryCount = commitChanges.filter((change) => change.isDirectory).length;
  const selectedUnversionedCount = commitChanges.filter((change) => change.item === "unversioned").length;

  let commitNotice: string | undefined;
  if (tortoiseSvn && !tortoiseSvn.autoSelectFiles) {
    commitNotice = "TortoiseSVN 已关闭自动选择提交项，打开后可能不会自动勾选。";
  } else if (tortoiseSvn && !tortoiseSvn.showUnversioned && selectedUnversionedCount) {
    commitNotice = `TortoiseSVN 已隐藏未版本化项，所选 ${selectedUnversionedCount} 项可能不会显示。`;
  } else if (selectedDirectoryCount) {
    commitNotice = `包含 ${selectedDirectoryCount} 个目录变更；TortoiseSVN 可能展开目录，请在提交窗口复核。`;
  }

  useEffect(() => {
    const availableValues = new Set(typeOptions.map((option) => option.value));
    setListExtensionFilters((current) => {
      if (current.includes(ALL_FILE_TYPES)) return current;
      const availableSelection = current.filter((value) => availableValues.has(value));
      return availableSelection.length === current.length ? current : availableSelection;
    });
  }, [typeOptions]);

  useEffect(() => {
    if (contextMenu && !changes.some((change) => change.path === contextMenu.change.path)) {
      setContextMenu(undefined);
    }
  }, [changes, contextMenu]);

  const openContextMenu = useCallback((
    change: ChangeEntry,
    x: number,
    y: number,
    returnFocus?: HTMLElement,
  ) => {
    setContextMenu({ change, x, y, returnFocus });
  }, []);
  const closeContextMenu = useCallback((restoreFocus = false) => {
    setContextMenu((current) => {
      if (restoreFocus && current?.returnFocus) {
        window.requestAnimationFrame(() => current.returnFocus?.focus());
      }
      return undefined;
    });
  }, []);

  const listEmptyMessage = listFilterMode === "text"
    ? listTextFilter.trim()
      ? `没有匹配“${listTextFilter.trim()}”的变更`
      : "没有可显示的变更"
    : listExtensionFilters.length
      ? "没有匹配所选后缀的变更"
      : "请至少选择一种文件后缀";

  return (
    <div className="changes-panel">
      <div className="changes-toolbar">
        <div className="changes-heading">
          <div>
            <strong>本地修改</strong>
            <span>{changes.length}</span>
          </div>
          <div className="status-summary" aria-label="状态统计">
            {Object.entries(counts).map(([code, count]) => (
              <span key={code}>
                <b className="status-text" data-status={code}>{displayStatusCode(code)}</b>{count}
              </span>
            ))}
          </div>
        </div>

        <div className="sidebar-view-toolbar">
          <div className="change-view-switch" role="group" aria-label="修改显示模式">
            <button
              type="button"
              className={changeView === "tree" ? "active" : ""}
              aria-pressed={changeView === "tree"}
              title="按目录层级显示"
              onClick={() => setChangeView("tree")}
            >
              <Icon name="tree" size={14} />
              层级
            </button>
            <button
              type="button"
              className={changeView === "list" ? "active" : ""}
              aria-pressed={changeView === "list"}
              title="以可排序的平铺列表显示"
              onClick={() => setChangeView("list")}
            >
              <Icon name="list" size={14} />
              列表
            </button>
          </div>

          {changeView === "list" && (
            <div className="list-sort-toolbar">
              <span className="list-sort-caption">排序</span>
              <label className="sort-select" title="列表排序字段">
                <span className="visually-hidden">排序字段</span>
                <select
                  value={listSortKey}
                  aria-label="排序字段"
                  onChange={(event) => setListSortKey(event.target.value as ChangeListSortKey)}
                >
                  <option value="path">相对路径</option>
                  <option value="name">文件名</option>
                  <option value="directory">所在目录</option>
                  <option value="status">修改状态</option>
                  <option value="extension">扩展名</option>
                </select>
              </label>
              <button
                type="button"
                className="sort-direction-button"
                title={sortDirection === "asc" ? "当前升序，点击切换为降序" : "当前降序，点击切换为升序"}
                aria-label={sortDirection === "asc" ? "升序排列" : "降序排列"}
                onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
              >
                <Icon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {changeView === "tree" ? (
        <SearchField
          value={treeQuery}
          ariaLabel="按文件名或路径筛选层级视图"
          placeholder="筛选文件名或路径"
          className="tree-filter-box"
          onChange={setTreeQuery}
        />
      ) : (
        <div className="list-filter-panel">
          <div className="list-filter-heading">
            <span className="list-filter-title">
              <Icon name="filter" size={14} />
              筛选
            </span>
            <div className="list-filter-mode" role="group" aria-label="列表筛选方式">
              <button
                type="button"
                className={listFilterMode === "text" ? "active" : ""}
                aria-pressed={listFilterMode === "text"}
                onClick={() => setListFilterMode("text")}
              >
                文本
              </button>
              <button
                type="button"
                className={listFilterMode === "extension" ? "active" : ""}
                aria-pressed={listFilterMode === "extension"}
                onClick={() => setListFilterMode("extension")}
              >
                后缀
              </button>
            </div>
            <span className="list-filter-count" title="筛选结果 / 全部修改">
              {filteredListChanges.length}/{changes.length}
            </span>
          </div>

          {listFilterMode === "text" ? (
            <SearchField
              value={listTextFilter}
              ariaLabel="按文件名或相对路径筛选列表"
              placeholder="输入文件名或相对路径，可用空格分词"
              className="list-filter-input"
              onChange={setListTextFilter}
            />
          ) : (
            <ExtensionFilterSelect
              options={typeOptions}
              selectedValues={listExtensionFilters}
              totalCount={changes.length}
              onChange={setListExtensionFilters}
            />
          )}
        </div>
      )}

      <div className="commit-selection-panel">
        <div className="commit-selection-summary">
          <span className="commit-selection-count">
            提交选择
            <b>{commitChanges.length}</b>
          </span>
          <div className="commit-selection-actions">
            <button
              type="button"
              disabled={!visibleCommitChanges.length}
              title={`${allVisibleSelected ? "取消选择" : "选择"}当前视图中的 ${visibleCommitChanges.length} 个可提交变更`}
              onClick={() => onToggleCommitSelection(visibleCommitChanges, !allVisibleSelected)}
            >
              {allVisibleSelected ? "取消当前" : "全选当前"}
            </button>
            <button
              type="button"
              disabled={!commitChanges.length}
              onClick={onClearCommitSelection}
            >
              清空
            </button>
          </div>
        </div>
        <button
          type="button"
          className="tortoise-commit-button"
          disabled={!commitChanges.length || !tortoiseSvn?.available || commitLaunching || workspaceUpdating}
          title={workspaceUpdating
            ? "SVN Update 进行中，请完成或取消后再提交"
            : !tortoiseSvn
            ? "正在检测 TortoiseSVN"
            : !tortoiseSvn.available
              ? "未检测到 TortoiseProc.exe"
              : commitChanges.length
                ? `把选中的 ${commitChanges.length} 项修改交给 TortoiseSVN 提交窗口`
                : "请先勾选要提交的修改"}
          onClick={onCommitSelection}
        >
          <Icon name="commit" size={15} className={commitLaunching ? "commit-launching" : undefined} />
          <span>
            {commitLaunching
              ? "正在打开 TortoiseSVN…"
              : !tortoiseSvn
                ? "正在检测 TortoiseSVN"
                : !tortoiseSvn.available
                  ? "未检测到 TortoiseSVN"
                  : "用 TortoiseSVN 提交"}
          </span>
          <b>{commitChanges.length}</b>
        </button>
        {commitNotice && (
          <div className="commit-selection-notice" role="status">
            <Icon name="warning" size={12} />
            <span>{commitNotice}</span>
          </div>
        )}
      </div>

      <div className="bulk-diff-toolbar">
          <button
            type="button"
            className="bulk-diff-button"
            disabled={!textDiffCount || Boolean(bulkDiffProgress) || workspaceUpdating}
            title={workspaceUpdating
              ? "SVN Update 进行中，结束后会自动重新扫描"
              : textDiffCount
              ? "更新全部白名单代码文本 Diff（.py、.cs、.bat、.ts、.cpp 等）"
              : "当前修改中没有符合后缀白名单的代码文本文件"}
            onClick={onUpdateAllTextDiffs}
          >
            <Icon
              name="refresh"
              size={14}
              className={bulkDiffProgress ? "rotating" : undefined}
            />
            <span>{bulkDiffProgress ? "正在更新文本 Diff" : "更新全部文本 Diff"}</span>
            <b aria-live="polite">
              {bulkDiffProgress
                ? `${bulkDiffProgress.completed}/${bulkDiffProgress.total}`
                : textDiffCount}
            </b>
          </button>
          {bulkDiffProgress && (
            <progress
              max={bulkDiffProgress.total}
              value={bulkDiffProgress.completed}
              aria-label={`正在更新文本 Diff：${bulkDiffProgress.completed}/${bulkDiffProgress.total}`}
            />
          )}
      </div>

      <div className="changes-scroll">
        {changes.length ? (
          changeView === "tree" ? (
            <ChangeTree
              scopeDirectory={directory}
              changes={changes}
              selectedPath={selectedPath}
              selectedCommitPaths={selectedCommitPaths}
              query={treeQuery}
              onSelect={onSelect}
              onToggleCommitSelection={onToggleCommitSelection}
              onOpenContextMenu={openContextMenu}
            />
          ) : (
            <ChangeList
              changes={filteredListChanges}
              totalCount={changes.length}
              emptyMessage={listEmptyMessage}
              selectedPath={selectedPath}
              selectedCommitPaths={selectedCommitPaths}
              sortKey={listSortKey}
              direction={sortDirection}
              onSelect={onSelect}
              onToggleCommitSelection={onToggleCommitSelection}
              onOpenContextMenu={openContextMenu}
            />
          )
        ) : (
          <div className="clean-state">
            <Icon name="empty" size={30} />
            <strong>工作区干净</strong>
            <span>此目录及子目录没有本地修改</span>
          </div>
        )}
      </div>
      {contextMenu && (
        <ChangeContextMenu
          change={contextMenu.change}
          x={contextMenu.x}
          y={contextMenu.y}
          tortoiseAvailable={tortoiseSvn?.available ?? false}
          workspaceUpdating={workspaceUpdating}
          onAction={onItemAction}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
