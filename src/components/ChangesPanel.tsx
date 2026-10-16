import { useCallback, useEffect, useMemo, useState } from "react";
import {
  actionPathKey,
  reconcileActionSelection,
  selectedActionChanges,
  updateActionSelection,
  type ActionSelectionModifiers,
} from "../actionSelection";
import {
  ALL_FILE_TYPES,
  fileTypeOptions,
  filterChanges,
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
import { StatusFilterSelect } from "./StatusFilterSelect";
import { ExtensionFilterSelect } from "./ExtensionFilterSelect";
import { Icon } from "./Icons";

interface ChangesPanelProps {
  directory: string;
  scopeDirectories: string[];
  changes: ChangeEntry[];
  selectedPath?: string;
  selectedCommitPaths: ReadonlySet<string>;
  tortoiseSvn?: TortoiseSvnAvailability;
  commitLaunching: boolean;
  workspaceUpdating: boolean;
  onRefreshVisible: (paths: string[]) => Promise<void>;
  onSelect: (change: ChangeEntry) => void;
  onToggleCommitSelection: (changes: ChangeEntry[], checked: boolean) => void;
  onClearCommitSelection: () => void;
  onCommitSelection: () => void;
  onItemAction: (
    action: ChangeItemAction,
    change: ChangeEntry,
    targets: ChangeEntry[],
  ) => void;
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
  scopeDirectories,
  changes,
  selectedPath,
  selectedCommitPaths,
  tortoiseSvn,
  commitLaunching,
  workspaceUpdating,
  onRefreshVisible,
  onSelect,
  onToggleCommitSelection,
  onClearCommitSelection,
  onCommitSelection,
  onItemAction,
}: ChangesPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [changeView, setChangeView] = useState<"tree" | "list">("tree");
  const [listSortKey, setListSortKey] = useState<ChangeListSortKey>("path");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [extensionFilters, setExtensionFilters] = useState<string[]>([ALL_FILE_TYPES]);
  const [includeDirectoryMatches, setIncludeDirectoryMatches] = useState(false);
  const [actionSelectionPaths, setActionSelectionPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [actionSelectionAnchor, setActionSelectionAnchor] = useState<string>();
  const [contextMenu, setContextMenu] = useState<{
    change: ChangeEntry;
    targets: ChangeEntry[];
    x: number;
    y: number;
    returnFocus?: HTMLElement;
  }>();
  const counts = useMemo(() => statusCounts(changes), [changes]);
  const typeOptions = useMemo(() => fileTypeOptions(changes), [changes]);
  const filteredChanges = useMemo(
    () => filterChanges(changes, filterText, extensionFilters, includeDirectoryMatches, statusFilters),
    [changes, extensionFilters, filterText, includeDirectoryMatches, statusFilters],
  );
  const visibleChanges = filteredChanges;
  const visibleCommitChanges = useMemo(
    () => visibleChanges.filter(isCommitSelectable),
    [visibleChanges],
  );
  const commitChanges = useMemo(
    () => selectedCommitChanges(changes, selectedCommitPaths),
    [changes, selectedCommitPaths],
  );
  const actionChanges = useMemo(
    () => selectedActionChanges(filteredChanges, actionSelectionPaths),
    [actionSelectionPaths, filteredChanges],
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
    setExtensionFilters((current) => {
      if (current.includes(ALL_FILE_TYPES)) return current;
      const availableSelection = current.filter((value) => availableValues.has(value));
      return availableSelection.length === current.length ? current : availableSelection;
    });
  }, [typeOptions]);

  useEffect(() => {
    setActionSelectionPaths((current) => reconcileActionSelection(current, filteredChanges));
    if (
      actionSelectionAnchor
      && !filteredChanges.some(
        (change) => actionPathKey(change.path) === actionPathKey(actionSelectionAnchor),
      )
    ) {
      setActionSelectionAnchor(undefined);
    }
  }, [actionSelectionAnchor, filteredChanges]);

  useEffect(() => {
    if (
      contextMenu
      && !contextMenu.change.contextOnly
      && !changes.some((change) => change.path === contextMenu.change.path)
    ) {
      setContextMenu(undefined);
    }
  }, [changes, contextMenu]);

  const openContextMenu = useCallback((
    change: ChangeEntry,
    x: number,
    y: number,
    returnFocus?: HTMLElement,
  ) => {
    let targets = [change];
    if (!change.contextOnly) {
      const clickedKey = actionPathKey(change.path);
      if (actionSelectionPaths.has(clickedKey)) {
        targets = selectedActionChanges(filteredChanges, actionSelectionPaths);
      } else {
        setActionSelectionPaths(new Set([clickedKey]));
        setActionSelectionAnchor(change.path);
      }
      onSelect(change);
    }
    setContextMenu({ change, targets, x, y, returnFocus });
  }, [actionSelectionPaths, filteredChanges, onSelect]);

  const selectChange = useCallback((
    change: ChangeEntry,
    modifiers: ActionSelectionModifiers,
    orderedChanges: ChangeEntry[],
  ) => {
    const result = updateActionSelection(
      actionSelectionPaths,
      change,
      orderedChanges,
      actionSelectionAnchor,
      modifiers,
    );
    setActionSelectionPaths(result.selectedPaths);
    setActionSelectionAnchor(result.anchorPath);
    onSelect(change);
  }, [actionSelectionAnchor, actionSelectionPaths, onSelect]);
  const closeContextMenu = useCallback((restoreFocus = false) => {
    setContextMenu((current) => {
      if (restoreFocus && current?.returnFocus) {
        window.requestAnimationFrame(() => current.returnFocus?.focus());
      }
      return undefined;
    });
  }, []);

  const filterEmptyMessage = !extensionFilters.length
    ? "请至少选择一种文件后缀"
    : filterText.trim()
      ? `没有匹配“${filterText.trim()}”和所选后缀的变更`
      : "没有匹配所选状态和后缀的变更";

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

      <div className="list-filter-panel combined-filter-panel">
        <div className="list-filter-heading">
          <button
            type="button"
            className="list-refresh-button"
            disabled={workspaceUpdating || refreshing || !visibleChanges.length}
            title="优先核对当前筛选列表的 SVN 状态（新增、修改、删除等），不批量读取文本 Diff；目录项包含子目录，核对后即可 Revert 或提交"
            onClick={async () => {
              setRefreshing(true);
              try { await onRefreshVisible(visibleChanges.map((change) => change.path)); }
              finally { setRefreshing(false); }
            }}
          >
            <Icon name="refresh" size={12} className={refreshing ? "rotating" : undefined} />
            <span>{refreshing ? "正在刷新…" : "刷新当前列表"}</span>
          </button>
          <span className="list-filter-title">
            <Icon name="filter" size={14} />
            组合筛选
          </span>
          <label
            className="directory-match-toggle"
            title="开启后，搜索目录名也会显示该目录下的匹配项；默认只匹配文件名"
          >
            <input
              type="checkbox"
              checked={includeDirectoryMatches}
              onChange={(event) => setIncludeDirectoryMatches(event.target.checked)}
            />
            <span aria-hidden="true" />
            目录路径
          </label>
          <span className="list-filter-count" title="筛选结果 / 全部修改">
            {filteredChanges.length}/{changes.length}
          </span>
        </div>

        <StatusFilterSelect
          changes={changes}
          selectedValues={statusFilters}
          onChange={setStatusFilters}
        />
        <div className="combined-filter-fields">
          <SearchField
            value={filterText}
            ariaLabel="按文件名筛选修改"
            placeholder={includeDirectoryMatches
              ? "文件名或相对路径（空格分词）"
              : "文件名（空格分词）"}
            className="list-filter-input"
            onChange={setFilterText}
          />
          <ExtensionFilterSelect
            options={typeOptions}
            selectedValues={extensionFilters}
            totalCount={changes.length}
            onChange={setExtensionFilters}
          />
        </div>
      </div>

      <div className={`action-selection-panel ${actionChanges.length ? "has-selection" : ""}`}>
        <span>
          <Icon name="check" size={13} />
          操作选择 <b>{actionChanges.length}</b>
        </span>
        <small>Ctrl 多选 · Shift 连选 · 右键批量操作</small>
        <button
          type="button"
          disabled={!actionChanges.length}
          onClick={() => {
            setActionSelectionPaths(new Set());
            setActionSelectionAnchor(undefined);
          }}
        >
          清除
        </button>
      </div>

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

      <div className="changes-scroll">
        {changes.length ? (
          !filteredChanges.length ? (
            <div className="tree-no-results">{filterEmptyMessage}</div>
          ) : changeView === "tree" ? (
            <ChangeTree
              scopeDirectory={directory}
              scopeDirectories={scopeDirectories}
              changes={filteredChanges}
              selectedPath={selectedPath}
              selectedActionPaths={actionSelectionPaths}
              selectedCommitPaths={selectedCommitPaths}
              onSelect={selectChange}
              onToggleCommitSelection={onToggleCommitSelection}
              onOpenContextMenu={openContextMenu}
            />
          ) : (
            <ChangeList
              changes={filteredChanges}
              totalCount={changes.length}
              emptyMessage={filterEmptyMessage}
              selectedPath={selectedPath}
              selectedActionPaths={actionSelectionPaths}
              selectedCommitPaths={selectedCommitPaths}
              sortKey={listSortKey}
              direction={sortDirection}
              onSelect={selectChange}
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
          targets={contextMenu.targets}
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
