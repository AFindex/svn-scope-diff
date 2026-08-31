import { useMemo, useState } from "react";
import { conflictLabel, isConflictedChange } from "../changeItemActions";
import { commitPathKey, isCommitSelectable } from "../commitSelection";
import { displayStatusCode } from "../status";
import { refreshTargetsForDirectory } from "../scanPatch";
import type { ChangeEntry, TreeNode } from "../types";
import { Icon } from "./Icons";
import { SelectionCheckbox, type SelectionState } from "./SelectionCheckbox";

interface ChangeTreeProps {
  scopeDirectory: string;
  scopeDirectories: string[];
  changes: ChangeEntry[];
  selectedPath?: string;
  selectedCommitPaths: ReadonlySet<string>;
  query: string;
  onSelect: (change: ChangeEntry) => void;
  onToggleCommitSelection: (changes: ChangeEntry[], checked: boolean) => void;
  onOpenContextMenu: (
    change: ChangeEntry,
    x: number,
    y: number,
    returnFocus?: HTMLElement,
  ) => void;
}

function makeNode(key: string, name: string, isFolder: boolean): TreeNode {
  return {
    key,
    name,
    isFolder,
    children: [],
    selectableChanges: [],
    conflictCount: 0,
    baseRevision: null,
  };
}

function buildTree(changes: ChangeEntry[]): TreeNode[] {
  const root = makeNode("", "", true);

  for (const change of changes) {
    const conflicted = isConflictedChange(change);
    const parts = change.relativePath === "." ? [change.name] : change.relativePath.split("/").filter(Boolean);
    let parent = root;
    let path = "";

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      path = path ? `${path}/${part}` : part;
      let node = parent.children.find((candidate) => candidate.name === part);
      if (!node) {
        node = makeNode(path, part, !isLast || change.isDirectory);
        parent.children.push(node);
      }
      if (isLast) {
        node.change = change;
        node.isFolder = change.isDirectory || node.children.length > 0;
      }
      if (isCommitSelectable(change)) node.selectableChanges.push(change);
      if (node.baseRevision === null && change.baseRevision !== null) {
        node.baseRevision = change.baseRevision;
      }
      if (conflicted) node.conflictCount += 1;
      parent = node;
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.isFolder !== right.isFolder) return left.isFolder ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" });
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

function statusTitle(change?: ChangeEntry) {
  if (!change) return "";
  if (isConflictedChange(change)) return conflictLabel(change);
  const labels: Record<string, string> = {
    added: "新增",
    deleted: "删除",
    missing: "丢失",
    modified: "修改",
    obstructed: "阻塞",
    replaced: "替换",
    unversioned: "未版本化",
    conflicted: "冲突",
    incomplete: "不完整",
    merged: "已合并",
    normal: "属性修改",
  };
  const base = labels[change.item] ?? change.item;
  return change.properties === "modified" && change.item !== "normal" ? `${base} + 属性修改` : base;
}

function contextChangeForNode(
  node: TreeNode,
  scopeDirectory: string,
  scopeDirectories: string[],
): ChangeEntry {
  if (node.change) return node.change;
  const separator = scopeDirectory.includes("\\") ? "\\" : "/";
  const relativePath = node.key.replaceAll("/", separator);
  const path = `${scopeDirectory.replace(/[\\/]+$/, "")}${separator}${relativePath}`;
  return {
    path,
    relativePath: node.key,
    name: node.name,
    item: "normal",
    properties: "none",
    statusCode: "•",
    isDirectory: true,
    treeConflicted: false,
    baseRevision: node.baseRevision,
    contextOnly: true,
    refreshPaths: refreshTargetsForDirectory(path, scopeDirectories),
  };
}

export function ChangeTree({
  scopeDirectory,
  scopeDirectories,
  changes,
  selectedPath,
  selectedCommitPaths,
  query,
  onSelect,
  onToggleCommitSelection,
  onOpenContextMenu,
}: ChangeTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return changes;
    return changes.filter((change) => change.relativePath.toLocaleLowerCase().includes(normalized));
  }, [changes, query]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const selectedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const visit = (node: TreeNode): number => {
      const own = node.change
        && isCommitSelectable(node.change)
        && selectedCommitPaths.has(commitPathKey(node.change.path))
        ? 1
        : 0;
      const total = node.children.reduce((sum, child) => sum + visit(child), own);
      counts.set(node.key, total);
      return total;
    };
    tree.forEach(visit);
    return counts;
  }, [selectedCommitPaths, tree]);

  const toggle = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderNode = (node: TreeNode, level: number) => {
    const isCollapsed = collapsed.has(node.key);
    const isSelected = node.change?.path === selectedPath;
    const directConflict = Boolean(node.change && isConflictedChange(node.change));
    const contextChange = contextChangeForNode(node, scopeDirectory, scopeDirectories);
    const commitChanges = node.selectableChanges;
    const commitSelectedCount = selectedCounts.get(node.key) ?? 0;
    const selectionState: SelectionState = commitSelectedCount === 0
      ? "none"
      : commitSelectedCount === commitChanges.length
        ? "all"
        : "some";
    return (
      <div key={node.key} className="tree-branch">
        <div
          className={`tree-row ${isSelected ? "selected" : ""} ${selectionState !== "none" ? "commit-selected" : ""} ${node.conflictCount ? "conflicted" : ""}`}
          style={{ paddingLeft: 4 + level * 16 }}
          title={node.change ? `${statusTitle(node.change)} · ${node.change.relativePath}` : node.name}
          onContextMenu={(event) => {
            event.preventDefault();
            if (node.change) onSelect(node.change);
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenContextMenu(
              contextChange,
              event.clientX || bounds.left + 32,
              event.clientY || bounds.bottom,
              event.currentTarget.querySelector<HTMLButtonElement>(".tree-open-target") ?? undefined,
            );
          }}
        >
          {node.isFolder ? (
            <button
              type="button"
              className={`tree-chevron ${isCollapsed ? "" : "expanded"}`}
              aria-label={isCollapsed ? `展开 ${node.name}` : `折叠 ${node.name}`}
              aria-expanded={!isCollapsed}
              onClick={(event) => {
                event.stopPropagation();
                toggle(node.key);
              }}
            >
              <Icon name="chevron" size={13} />
            </button>
          ) : (
            <span className="tree-chevron-spacer" />
          )}
          <SelectionCheckbox
            state={selectionState}
            disabled={!commitChanges.length}
            label={`选择提交 ${node.key}`}
            title={commitChanges.length
              ? `选择此项包含的 ${commitChanges.length} 个变更`
              : "未版本化目录不会直接转交，避免 TortoiseSVN 递归加入未知文件"}
            onChange={(checked) => onToggleCommitSelection(commitChanges, checked)}
          />
          <button
            type="button"
            className="tree-open-target"
            onClick={() => {
              if (node.change) onSelect(node.change);
              else if (node.isFolder) toggle(node.key);
            }}
            onDoubleClick={() => node.isFolder && toggle(node.key)}
          >
            <span className={`tree-kind ${node.isFolder ? "folder" : "file"}`}>
              <Icon name={node.isFolder && !isCollapsed ? "folderOpen" : node.isFolder ? "folder" : "file"} size={16} />
            </span>
            <span className="tree-name">{node.name}</span>
            {node.conflictCount > 0 && (
              <span
                className={`tree-conflict-indicator ${directConflict ? "direct" : "nested"}`}
                title={directConflict
                  ? conflictLabel(node.change!)
                  : `此目录包含 ${node.conflictCount} 个冲突项`}
              >
                <Icon name="conflict" size={12} />
                {!directConflict && node.conflictCount > 1 && <small>{node.conflictCount}</small>}
              </span>
            )}
            {node.change && (
              <span className="status-badge" data-status={node.change.statusCode} title={statusTitle(node.change)}>
                {displayStatusCode(node.change.statusCode)}
              </span>
            )}
          </button>
        </div>
        {node.isFolder && !isCollapsed && node.children.map((child) => renderNode(child, level + 1))}
      </div>
    );
  };

  if (!filtered.length && changes.length) {
    return <div className="tree-no-results">没有匹配“{query}”的变更</div>;
  }
  return <div className="change-tree" role="tree" aria-label="本地修改层级">{tree.map((node) => renderNode(node, 0))}</div>;
}
