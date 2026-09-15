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
  targets?: ChangeEntry[];
  x: number;
  y: number;
  tortoiseAvailable: boolean;
  workspaceUpdating: boolean;
  scopeDirectory?: boolean;
  canRemoveScope?: boolean;
  onAction: (
    action: ChangeItemAction,
    change: ChangeEntry,
    targets: ChangeEntry[],
  ) => void;
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
  targets,
  x,
  y,
  tortoiseAvailable,
  workspaceUpdating,
  scopeDirectory = false,
  canRemoveScope = false,
  onAction,
  onClose,
}: ChangeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const selectedTargets = targets?.length ? targets : [change];
  const batch = selectedTargets.length > 1;
  const capabilities = changeActionCapabilities(change, tortoiseAvailable);
  const committableTargets = selectedTargets.filter((target) => (
    !target.contextOnly
    && !(target.item === "unversioned" && target.isDirectory)
    && !isConflictedChange(target)
  ));
  const revertibleTargets = selectedTargets.filter(
    (target) => target.item !== "unversioned" && !target.contextOnly,
  );
  const resolvableTargets = selectedTargets.filter(isConflictedChange);
  const conflicted = isConflictedChange(change);
  const virtualDirectory = change.isDirectory && Boolean(change.contextOnly);
  const hasRepositoryHistory = change.item !== "unversioned"
    && change.baseRevision !== null
    && !["added", "obstructed", "incomplete"].includes(change.item);
  const showRevert = batch
    ? revertibleTargets.length > 0
    : !change.isDirectory || (!change.contextOnly && change.item !== "unversioned");
  const showBlame = !batch && !change.isDirectory;
  const showLog = !batch && (!change.isDirectory || hasRepositoryHistory);
  const showRepositorySection = showRevert || showBlame || showLog;
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

  const choose = (action: ChangeItemAction, actionTargets = selectedTargets) => {
    onClose(false);
    onAction(action, change, actionTargets);
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
      aria-label={batch ? `${selectedTargets.length} 个已选变更的常用操作` : `${change.relativePath} 常用操作`}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      <div className="change-context-header">
        {virtualDirectory ? (
          <span className="change-context-folder-icon"><Icon name="folderOpen" size={16} /></span>
        ) : (
          <span className="status-badge" data-status={change.statusCode}>
            {displayStatusCode(change.statusCode)}
          </span>
        )}
        <span>
          <strong title={change.relativePath}>{batch ? `已选 ${selectedTargets.length} 项变更` : change.name}</strong>
          <small title={change.relativePath}>{batch ? `${change.relativePath} 等` : change.relativePath}</small>
        </span>
        {batch && <span className="change-context-batch-chip">批量</span>}
        {scopeDirectory && <span className="change-context-scope-chip">扫描范围</span>}
        {conflicted && (
          <span className="change-context-conflict" title={conflictLabel(change)}>
            <Icon name="conflict" size={12} />
            冲突
          </span>
        )}
      </div>

      <div className="change-context-section">
        <MenuItem
          icon="refresh"
          label={batch ? `刷新所选 ${selectedTargets.length} 项` : change.isDirectory ? "局部刷新此目录" : "刷新此项状态"}
          hint="仅此范围"
          disabled={workspaceUpdating}
          title={workspaceUpdating
            ? updateBlockedTitle
            : batch
              ? "只重新扫描当前操作选择中的路径"
              : change.isDirectory
              ? "只重新扫描此目录及其子目录"
              : "只重新读取此文件的 SVN 状态"}
          onSelect={() => choose("refresh")}
        />
      </div>

      {!virtualDirectory && (
        <>
          <div className="change-context-separator" />
          <div className="change-context-section">
            <MenuItem
              icon="commit"
              label={batch ? `提交所选 ${committableTargets.length} 项…` : "单独提交此项…"}
              hint="TortoiseSVN"
              disabled={workspaceUpdating || !tortoiseAvailable || !committableTargets.length}
              title={workspaceUpdating
                ? updateBlockedTitle
                : !tortoiseAvailable
                  ? unavailableTitle
                : committableTargets.length
                ? batch
                  ? `将 ${committableTargets.length} 个可提交目标交给 TortoiseSVN`
                  : "只将此项目标交给 TortoiseSVN 提交窗口"
                : unavailableTitle
                  ?? (conflicted
                    ? "请先解决冲突后再提交"
                    : "未版本化目录不能作为精确单项提交目标")}
              onSelect={() => choose("commit", committableTargets)}
            />
          </div>
        </>
      )}

      {(conflicted || resolvableTargets.length > 0) && (
        <>
          <div className="change-context-separator" />
          <div className="change-context-section conflict-actions">
            {!batch && !change.isDirectory && (
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
            )}
            <MenuItem
              icon="check"
              label={batch ? `标记 ${resolvableTargets.length} 个冲突为已解决…` : "标记为已解决…"}
              disabled={workspaceUpdating || !tortoiseAvailable || !resolvableTargets.length}
              title={workspaceUpdating
                ? updateBlockedTitle
                : !tortoiseAvailable
                  ? unavailableTitle
                : resolvableTargets.length
                ? "由 TortoiseSVN 再次确认后标记为已解决"
                : unavailableTitle}
              onSelect={() => choose("resolve", resolvableTargets)}
            />
          </div>
        </>
      )}

      {showRepositorySection && (
        <>
          <div className="change-context-separator" />
          <div className="change-context-section">
            {showRevert && (
              <MenuItem
                icon="undo"
                label={batch ? `Revert 所选 ${revertibleTargets.length} 项…` : "Revert 修改…"}
                disabled={workspaceUpdating || !tortoiseAvailable || !revertibleTargets.length}
                title={workspaceUpdating
                  ? updateBlockedTitle
                  : !tortoiseAvailable
                    ? unavailableTitle
                  : revertibleTargets.length
                  ? "打开 TortoiseSVN Revert 确认窗口，不会静默还原"
                  : unavailableTitle ?? "未版本化项目没有可还原的 BASE 内容"}
                danger
                onSelect={() => choose("revert", revertibleTargets)}
              />
            )}
            {showBlame && (
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
            )}
            {showLog && (
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
            )}
          </div>
        </>
      )}

      {!batch && (
        <>
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
        </>
      )}

      <div className="change-context-separator" />
      <div className="change-context-section">
        <MenuItem
          icon="copy"
          label={batch ? `复制 ${selectedTargets.length} 个相对路径` : "复制相对路径"}
          onSelect={() => choose("copyRelativePath")}
        />
        <MenuItem
          icon="copy"
          label={batch ? `复制 ${selectedTargets.length} 个完整路径` : "复制完整路径"}
          onSelect={() => choose("copyFullPath")}
        />
      </div>
      {scopeDirectory && canRemoveScope && (
        <>
          <div className="change-context-separator" />
          <div className="change-context-section">
            <MenuItem
              icon="close"
              label="移出扫描范围"
              title="停止扫描此目录；不会删除或修改磁盘文件"
              onSelect={() => choose("removeScope")}
            />
          </div>
        </>
      )}
      <div className="change-context-footer">↑ ↓ 选择 · Enter 执行 · Esc 关闭</div>
    </div>
  );

  return createPortal(menu, document.body);
}
