import { useMemo, useState } from "react";
import { displayStatusCode } from "../status";
import type { ChangeEntry, TreeNode } from "../types";
import { Icon } from "./Icons";

interface ChangeTreeProps {
  changes: ChangeEntry[];
  selectedPath?: string;
  query: string;
  onSelect: (change: ChangeEntry) => void;
}

function makeNode(key: string, name: string, isFolder: boolean): TreeNode {
  return { key, name, isFolder, children: [] };
}

function buildTree(changes: ChangeEntry[]): TreeNode[] {
  const root = makeNode("", "", true);

  for (const change of changes) {
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

export function ChangeTree({ changes, selectedPath, query, onSelect }: ChangeTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return changes;
    return changes.filter((change) => change.relativePath.toLocaleLowerCase().includes(normalized));
  }, [changes, query]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

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
    return (
      <div key={node.key} className="tree-branch">
        <button
          type="button"
          className={`tree-row ${isSelected ? "selected" : ""} ${node.change ? "clickable" : ""}`}
          style={{ paddingLeft: 10 + level * 18 }}
          title={node.change ? `${statusTitle(node.change)} · ${node.change.relativePath}` : node.name}
          onClick={() => {
            if (node.change) onSelect(node.change);
            else if (node.isFolder) toggle(node.key);
          }}
          onDoubleClick={() => node.isFolder && toggle(node.key)}
        >
          {node.isFolder ? (
            <span
              className={`tree-chevron ${isCollapsed ? "" : "expanded"}`}
              onClick={(event) => {
                event.stopPropagation();
                toggle(node.key);
              }}
            >
              <Icon name="chevron" size={13} />
            </span>
          ) : (
            <span className="tree-chevron-spacer" />
          )}
          <span className={`tree-kind ${node.isFolder ? "folder" : "file"}`}>
            <Icon name={node.isFolder && !isCollapsed ? "folderOpen" : node.isFolder ? "folder" : "file"} size={16} />
          </span>
          <span className="tree-name">{node.name}</span>
          {node.change && (
            <span className="status-badge" data-status={node.change.statusCode} title={statusTitle(node.change)}>
              {displayStatusCode(node.change.statusCode)}
            </span>
          )}
        </button>
        {node.isFolder && !isCollapsed && node.children.map((child) => renderNode(child, level + 1))}
      </div>
    );
  };

  if (!filtered.length && changes.length) {
    return <div className="tree-no-results">没有匹配“{query}”的变更</div>;
  }
  return <div className="change-tree">{tree.map((node) => renderNode(node, 0))}</div>;
}
