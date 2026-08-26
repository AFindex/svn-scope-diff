import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  changeActionCapabilities,
  conflictLabel,
  isConflictedChange,
  type ChangeItemAction,
} from "../changeItemActions";
import { displayStatusCode } from "../status";
import type { ChangeEntry } from "../types";
import { Icon } from "./Icons";

interface ChangeContextMenuProps {
  change: ChangeEntry;
  x: number;
  y: number;
  tortoiseAvailable: boolean;
  workspaceUpdating: boolean;
  onAction: (action: ChangeItemAction, change: ChangeEntry) => void;
  onClose: (restoreFocus?: boolean) => void;
}

interface MenuItemProps {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  hint?: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  onSelect: () => void;
}

function MenuItem({
  icon,
  label,
  hint,
  disabled = false,
  title,
  danger = false,
  onSelect,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`change-context-item ${danger ? "danger" : ""}`}
      disabled={disabled}
      title={title}
      onClick={onSelect}
    >
      <span className="change-context-icon"><Icon name={icon} size={15} /></span>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

export function ChangeContextMenu({
  change,
  x,
  y,
  tortoiseAvailable,
  workspaceUpdating,
  onAction,
  onClose,
}: ChangeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const capabilities = changeActionCapabilities(change, tortoiseAvailable);
  const conflicted = isConflictedChange(change);
  const unavailableTitle = tortoiseAvailable ? undefined : "未检测到 TortoiseSVN";
  const updateBlockedTitle = "SVN Update 进行中，请完成或取消后再执行此操作";

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose(false);
    };
    const close = () => onClose(false);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const choose = (action: ChangeItemAction) => {
    onClose(false);
    onAction(action, change);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    ) ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") items[0].focus();
    else if (event.key === "End") items.at(-1)?.focus();
    else {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = current < 0 ? 0 : (current + delta + items.length) % items.length;
      items[next].focus();
    }
  };

  const menu = (
    <div
      ref={menuRef}
      className="change-context-menu"
      style={position}
      role="menu"
      aria-label={`${change.relativePath} 常用操作`}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      <div className="change-context-header">
        <span className="status-badge" data-status={change.statusCode}>
          {displayStatusCode(change.statusCode)}
        </span>
        <span>
          <strong title={change.relativePath}>{change.name}</strong>
          <small title={change.relativePath}>{change.relativePath}</small>
        </span>
        {conflicted && (
          <span className="change-context-conflict" title={conflictLabel(change)}>
            <Icon name="conflict" size={12} />
            冲突
          </span>
        )}
      </div>

      <div className="change-context-section">
        <MenuItem
          icon="commit"
          label="单独提交此项…"
          hint="TortoiseSVN"
          disabled={workspaceUpdating || !capabilities.canCommit}
          title={workspaceUpdating
            ? updateBlockedTitle
            : capabilities.canCommit
            ? "只将此项目标交给 TortoiseSVN 提交窗口"
            : unavailableTitle
              ?? (conflicted
                ? "请先解决冲突后再提交"
                : change.contextOnly
                  ? "层级分组不是独立变更，请选择其中的具体变更"
                  : "未版本化目录不能作为精确单项提交目标")}
          onSelect={() => choose("commit")}
        />
      </div>

      {conflicted && (
        <>
          <div className="change-context-separator" />
          <div className="change-context-section conflict-actions">
            <MenuItem
              icon="conflict"
              label="打开冲突编辑器…"
              hint="Resolve"
              disabled={workspaceUpdating || !capabilities.canConflictEditor}
              title={workspaceUpdating
                ? updateBlockedTitle
                : capabilities.canConflictEditor
                ? "使用 TortoiseSVN 配置的三方合并工具打开"
                : unavailableTitle ?? "仅文本文件冲突可打开三方冲突编辑器"}
              onSelect={() => choose("conflictEditor")}
            />
            <MenuItem
              icon="check"
              label="标记为已解决…"
              disabled={workspaceUpdating || !capabilities.canResolve}
              title={workspaceUpdating
                ? updateBlockedTitle
                : capabilities.canResolve
                ? "由 TortoiseSVN 再次确认后标记为已解决"
                : unavailableTitle}
              onSelect={() => choose("resolve")}
            />
          </div>
        </>
      )}

      <div className="change-context-separator" />
      <div className="change-context-section">
        <MenuItem
          icon="undo"
          label="Revert 修改…"
          disabled={workspaceUpdating || !capabilities.canRevert}
          title={workspaceUpdating
            ? updateBlockedTitle
            : capabilities.canRevert
            ? "打开 TortoiseSVN Revert 确认窗口，不会静默还原"
            : unavailableTitle
              ?? (change.contextOnly
                ? "层级分组不是独立变更，请选择其中的具体变更"
                : "未版本化项目没有可还原的 BASE 内容")}
          danger
          onSelect={() => choose("revert")}
        />
        <MenuItem
          icon="blame"
          label="追溯（Blame）…"
          disabled={workspaceUpdating || !capabilities.canBlame}
          title={workspaceUpdating
            ? updateBlockedTitle
            : capabilities.canBlame
            ? "打开 TortoiseSVN Blame 范围窗口"
            : unavailableTitle ?? "Blame 仅适用于有仓库历史的版本化文件"}
          onSelect={() => choose("blame")}
        />
        <MenuItem
          icon="history"
          label="显示日志（Show Log）…"
          disabled={workspaceUpdating || !capabilities.canShowLog}
          title={workspaceUpdating
            ? updateBlockedTitle
            : capabilities.canShowLog
            ? "显示此项目的 SVN 提交历史"
            : unavailableTitle ?? "未版本化项目没有仓库日志"}
          onSelect={() => choose("showLog")}
        />
      </div>

      <div className="change-context-separator" />
      <div className="change-context-section">
        <MenuItem
          icon="file"
          label={change.isDirectory ? "打开目录" : "打开"}
          disabled={!capabilities.canOpen}
          title={capabilities.canOpen ? "使用系统默认程序打开" : "项目在工作副本中已不存在"}
          onSelect={() => choose("open")}
        />
        <MenuItem
          icon="locate"
          label="在资源管理器中显示"
          onSelect={() => choose("reveal")}
        />
      </div>

      <div className="change-context-separator" />
      <div className="change-context-section">
        <MenuItem
          icon="copy"
          label="复制相对路径"
          onSelect={() => choose("copyRelativePath")}
        />
        <MenuItem
          icon="copy"
          label="复制完整路径"
          onSelect={() => choose("copyFullPath")}
        />
      </div>
      <div className="change-context-footer">↑ ↓ 选择 · Enter 执行 · Esc 关闭</div>
    </div>
  );

  return createPortal(menu, document.body);
}
