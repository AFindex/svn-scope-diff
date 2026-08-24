import { useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { displayStatusCode } from "../status";
import type { ChangeEntry, DiffResult } from "../types";
import { Icon } from "./Icons";

interface DiffPaneProps {
  selected?: ChangeEntry;
  diff?: DiffResult;
  loading: boolean;
  error?: string;
  beyondCompareAvailable: boolean;
  beyondComparePath?: string | null;
  onOpenBeyondCompare: () => void;
  propertyDiff?: string | null;
  propertyDiffLoading: boolean;
  propertyDiffLoaded: boolean;
  propertyDiffError?: string;
  onLoadPropertyDiff: () => void;
}

type DiffViewMode = "diff" | "all";
type MountedDiffEditor = Parameters<DiffOnMount>[0];
type CollapsibleDiffEditor = MountedDiffEditor & {
  collapseAllUnchangedRegions: () => void;
  showAllUnchangedRegions: () => void;
};

const hiddenRegionOptions = {
  revealLineCount: 3,
  minimumLineCount: 4,
  contextLineCount: 3,
};

function applyCollapsedState(editor: MountedDiffEditor, mode: DiffViewMode) {
  const collapsible = editor as CollapsibleDiffEditor;
  if (mode === "diff") collapsible.collapseAllUnchangedRegions();
  else collapsible.showAllUnchangedRegions();
}

function updateViewMode(editor: MountedDiffEditor, mode: DiffViewMode) {
  editor.updateOptions({
    hideUnchangedRegions: {
      enabled: mode === "diff",
      ...hiddenRegionOptions,
    },
  });
  window.requestAnimationFrame(() => applyCollapsedState(editor, mode));
}

function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLocaleLowerCase() ?? "";
  const languages: Record<string, string> = {
    bat: "bat",
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    csv: "plaintext",
    go: "go",
    h: "cpp",
    hpp: "cpp",
    htm: "html",
    html: "html",
    ini: "ini",
    java: "java",
    js: "javascript",
    json: "json",
    jsonc: "json",
    jsx: "javascript",
    less: "less",
    lua: "lua",
    md: "markdown",
    php: "php",
    ps1: "powershell",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "shell",
    sql: "sql",
    svg: "xml",
    toml: "ini",
    ts: "typescript",
    tsx: "typescript",
    txt: "plaintext",
    vue: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return languages[extension] ?? "plaintext";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function DiffPane({
  selected,
  diff,
  loading,
  error,
  beyondCompareAvailable,
  beyondComparePath,
  onOpenBeyondCompare,
  propertyDiff,
  propertyDiffLoading,
  propertyDiffLoaded,
  propertyDiffError,
  onLoadPropertyDiff,
}: DiffPaneProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("all");
  const viewModeRef = useRef<DiffViewMode>(viewMode);
  const editorRef = useRef<MountedDiffEditor | null>(null);
  const diffUpdateListenerRef = useRef<{ dispose: () => void } | null>(null);

  const handleEditorMount: DiffOnMount = (editor) => {
    diffUpdateListenerRef.current?.dispose();
    editorRef.current = editor;
    diffUpdateListenerRef.current = editor.onDidUpdateDiff(() => {
      window.requestAnimationFrame(() => applyCollapsedState(editor, viewModeRef.current));
    });
    updateViewMode(editor, viewModeRef.current);
  };

  useEffect(() => {
    viewModeRef.current = viewMode;
    if (editorRef.current) updateViewMode(editorRef.current, viewMode);
  }, [viewMode]);

  useEffect(
    () => () => {
      diffUpdateListenerRef.current?.dispose();
      editorRef.current = null;
    },
    [],
  );

  if (!selected) {
    return (
      <div className="diff-placeholder">
        <div className="placeholder-art">
          <Icon name="app" size={42} />
        </div>
        <h2>选择一项变更</h2>
        <p>左侧选择文件后，这里会显示 BASE 与工作副本的并排差异。</p>
      </div>
    );
  }

  const bcDisabled = !beyondCompareAvailable || selected.isDirectory;
  const bcTitle = selected.isDirectory
    ? "目录不提供外部文件比较"
    : beyondCompareAvailable
      ? beyondComparePath ?? "使用 Beyond Compare 打开"
      : "未检测到 Beyond Compare 4/5";
  const canSwitchView = Boolean(diff && !diff.isBinary && !diff.isDirectory);

  return (
    <section className="diff-pane">
      <header className="diff-header">
        <div className="diff-file-identity">
          <span className="status-badge" data-status={selected.statusCode}>
            {displayStatusCode(selected.statusCode)}
          </span>
          <Icon name={selected.isDirectory ? "folder" : "file"} size={16} />
          <strong title={selected.path}>{selected.relativePath}</strong>
          {selected.properties === "modified" && <span className="property-chip">属性已修改</span>}
        </div>
        <div className="diff-header-actions">
          {canSwitchView && (
            <div className="diff-display-control">
              <span>视图</span>
              <div className="diff-mode-switch" role="group" aria-label="Diff 显示模式">
                <button
                  type="button"
                  className={viewMode === "diff" ? "active" : ""}
                  aria-pressed={viewMode === "diff"}
                  title="折叠未修改区域，只显示差异上下文"
                  onClick={() => setViewMode("diff")}
                >
                  差异
                </button>
                <button
                  type="button"
                  className={viewMode === "all" ? "active" : ""}
                  aria-pressed={viewMode === "all"}
                  title="显示完整文件"
                  onClick={() => setViewMode("all")}
                >
                  全部
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            className="secondary-button bc-button"
            disabled={bcDisabled}
            title={bcTitle}
            onClick={onOpenBeyondCompare}
          >
            <Icon name="external" size={15} />
            Beyond Compare
          </button>
        </div>
      </header>

      {loading ? (
        <div className="diff-loading">
          <span className="spinner large" />
          <span>正在读取 BASE 与工作文件…</span>
        </div>
      ) : error ? (
        <div className="inline-error diff-error">
          <Icon name="warning" size={23} />
          <div>
            <strong>无法生成 diff</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : diff ? (
        <>
          <div className={`diff-side-labels ${canSwitchView ? "with-overview" : ""}`}>
            <div>
              <span>{diff.originalLabel}</span>
              <small>{diff.originalEncoding} · {formatBytes(diff.originalBytes)}</small>
            </div>
            <div>
              <span>{diff.modifiedLabel}</span>
              <small>{diff.modifiedEncoding} · {formatBytes(diff.modifiedBytes)}</small>
            </div>
            {canSwitchView && (
              <div
                className="diff-overview-label"
                title="Diff 总览：红色表示删除，绿色表示新增；点击或拖动可快速定位"
              >
                <i className="removed" />
                <i className="inserted" />
                <span className="visually-hidden">Diff 总览</span>
              </div>
            )}
          </div>

          {diff.isBinary || diff.isDirectory ? (
            <div className="special-diff-state">
              <div className="special-diff-icon">
                <Icon name={diff.isDirectory ? "folderOpen" : "file"} size={42} />
              </div>
              <h2>{diff.isDirectory ? "目录变更" : "二进制文件"}</h2>
              <p>{diff.note}</p>
              {diff.isBinary && beyondCompareAvailable && (
                <button type="button" className="primary-button" onClick={onOpenBeyondCompare}>
                  <Icon name="external" size={16} />
                  使用 Beyond Compare 查看
                </button>
              )}
            </div>
          ) : (
            <div className="monaco-host">
              {diff.note && <div className="diff-note">{diff.note}</div>}
              <DiffEditor
                original={diff.original}
                modified={diff.modified}
                language={languageForPath(diff.path)}
                theme="svn-scope-light"
                onMount={handleEditorMount}
                loading={<div className="diff-loading"><span className="spinner" /> 正在加载编辑器…</div>}
                options={{
                  readOnly: true,
                  originalEditable: false,
                  renderSideBySide: true,
                  automaticLayout: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  renderOverviewRuler: true,
                  overviewRulerLanes: 2,
                  overviewRulerBorder: false,
                  hideCursorInOverviewRuler: true,
                  folding: false,
                  glyphMargin: false,
                  lineNumbersMinChars: 4,
                  fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
                  fontSize: 13,
                  lineHeight: 20,
                  wordWrap: "off",
                  renderWhitespace: "selection",
                  diffWordWrap: "off",
                  ignoreTrimWhitespace: false,
                  enableSplitViewResizing: true,
                  renderMarginRevertIcon: false,
                  accessibilityPageSize: 20,
                  padding: { top: 6, bottom: 6 },
                  smoothScrolling: true,
                  hideUnchangedRegions: {
                    enabled: viewMode === "diff",
                    ...hiddenRegionOptions,
                  },
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "auto",
                    verticalScrollbarSize: 8,
                    verticalSliderSize: 6,
                    horizontalScrollbarSize: 8,
                    horizontalSliderSize: 6,
                    useShadows: false,
                    alwaysConsumeMouseWheel: false,
                  },
                }}
              />
            </div>
          )}

          {(selected.properties === "modified" || selected.properties === "conflicted") && (
            <details
              className="property-diff"
              onToggle={(event) => {
                if (event.currentTarget.open) onLoadPropertyDiff();
              }}
            >
              <summary>SVN 属性差异</summary>
              {propertyDiffLoading ? (
                <div className="property-diff-message">
                  <span className="spinner" /> 正在读取属性差异…
                </div>
              ) : propertyDiffError ? (
                <div className="property-diff-message error">{propertyDiffError}</div>
              ) : propertyDiffLoaded ? (
                propertyDiff ? <pre>{propertyDiff}</pre> : <div className="property-diff-message">没有可显示的属性差异。</div>
              ) : (
                <div className="property-diff-message">展开后读取属性差异。</div>
              )}
            </details>
          )}

        </>
      ) : null}
    </section>
  );
}
