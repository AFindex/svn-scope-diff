import { useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import {
  conflictLabel,
  countConflictBlocks,
  isConflictedChange,
} from "../changeItemActions";
import { wrapSearchMatchIndex } from "../diffSearch";
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
  tortoiseSvnAvailable: boolean;
  onOpenConflictEditor: () => void;
  onMarkResolved: () => void;
  propertyDiff?: string | null;
  propertyDiffLoading: boolean;
  propertyDiffLoaded: boolean;
  propertyDiffError?: string;
  onLoadPropertyDiff: () => void;
}

type DiffViewMode = "diff" | "all";
type DiffSide = "original" | "modified";
type MountedDiffEditor = Parameters<DiffOnMount>[0];
type MountedCodeEditor = ReturnType<MountedDiffEditor["getOriginalEditor"]>;
type DecorationsCollection = ReturnType<MountedCodeEditor["createDecorationsCollection"]>;
type CollapsibleDiffEditor = MountedDiffEditor & {
  collapseAllUnchangedRegions: () => void;
  showAllUnchangedRegions: () => void;
};

const hiddenRegionOptions = {
  revealLineCount: 3,
  minimumLineCount: 4,
  contextLineCount: 3,
};

interface SideSearchState {
  open: boolean;
  query: string;
  currentIndex: number;
  matchCount: number;
}

const createInitialSideSearch = (): SideSearchState => ({
  open: false,
  query: "",
  currentIndex: -1,
  matchCount: 0,
});

const SEARCH_MATCH_LIMIT = 10_000;

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
  tortoiseSvnAvailable,
  onOpenConflictEditor,
  onMarkResolved,
  propertyDiff,
  propertyDiffLoading,
  propertyDiffLoaded,
  propertyDiffError,
  onLoadPropertyDiff,
}: DiffPaneProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("all");
  const [diffCount, setDiffCount] = useState(0);
  const [editorReady, setEditorReady] = useState(false);
  const [sideSearches, setSideSearches] = useState<Record<DiffSide, SideSearchState>>({
    original: createInitialSideSearch(),
    modified: createInitialSideSearch(),
  });
  const viewModeRef = useRef<DiffViewMode>(viewMode);
  const editorRef = useRef<MountedDiffEditor | null>(null);
  const diffUpdateListenerRef = useRef<{ dispose: () => void } | null>(null);
  const editorDisposeListenerRef = useRef<{ dispose: () => void } | null>(null);
  const originalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const modifiedSearchInputRef = useRef<HTMLInputElement | null>(null);
  const originalSearchDecorationsRef = useRef<DecorationsCollection | null>(null);
  const modifiedSearchDecorationsRef = useRef<DecorationsCollection | null>(null);

  const handleEditorMount: DiffOnMount = (editor) => {
    diffUpdateListenerRef.current?.dispose();
    editorDisposeListenerRef.current?.dispose();
    originalSearchDecorationsRef.current?.clear();
    modifiedSearchDecorationsRef.current?.clear();
    originalSearchDecorationsRef.current = null;
    modifiedSearchDecorationsRef.current = null;
    editorRef.current = editor;
    setEditorReady(true);
    const updateDiffCount = () => setDiffCount(editor.getLineChanges()?.length ?? 0);
    diffUpdateListenerRef.current = editor.onDidUpdateDiff(() => {
      window.requestAnimationFrame(() => {
        applyCollapsedState(editor, viewModeRef.current);
        updateDiffCount();
      });
    });
    editorDisposeListenerRef.current = editor.onDidDispose(() => {
      if (editorRef.current === editor) {
        editorRef.current = null;
        originalSearchDecorationsRef.current = null;
        modifiedSearchDecorationsRef.current = null;
        setEditorReady(false);
        setDiffCount(0);
      }
    });
    updateViewMode(editor, viewModeRef.current);
    window.requestAnimationFrame(updateDiffCount);
  };

  const navigateDiff = (target: "next" | "previous") => {
    const editor = editorRef.current;
    if (!editor || !diffCount) return;
    editor.goToDiff(target);
  };

  const getSideEditor = (side: DiffSide) => {
    const diffEditor = editorRef.current;
    if (!diffEditor) return null;
    return side === "original"
      ? diffEditor.getOriginalEditor()
      : diffEditor.getModifiedEditor();
  };

  const getSearchDecorations = (side: DiffSide, editor: MountedCodeEditor) => {
    const ref = side === "original"
      ? originalSearchDecorationsRef
      : modifiedSearchDecorationsRef;
    if (!ref.current) ref.current = editor.createDecorationsCollection();
    return ref.current;
  };

  const renderSideSearch = (side: DiffSide, query: string, requestedIndex: number) => {
    const editor = getSideEditor(side);
    const model = editor?.getModel();
    if (!editor || !model || !query) {
      if (editor) getSearchDecorations(side, editor).clear();
      return { currentIndex: -1, matchCount: 0 };
    }

    const matches = model.findMatches(
      query,
      false,
      false,
      false,
      null,
      false,
      SEARCH_MATCH_LIMIT,
    );
    const currentIndex = wrapSearchMatchIndex(requestedIndex, matches.length);
    getSearchDecorations(side, editor).set(matches.map((match, index) => ({
      range: match.range,
      options: {
        inlineClassName: index === currentIndex
          ? "svn-scope-search-match svn-scope-search-current"
          : "svn-scope-search-match",
      },
    })));

    if (currentIndex >= 0) {
      const range = matches[currentIndex].range;
      editor.setSelection(range);
      editor.revealRangeInCenter(range);
    }

    return { currentIndex, matchCount: matches.length };
  };

  const updateSideSearchQuery = (side: DiffSide, query: string) => {
    const result = renderSideSearch(side, query, 0);
    setSideSearches((current) => ({
      ...current,
      [side]: { ...current[side], query, ...result },
    }));
  };

  const navigateSideSearch = (side: DiffSide, target: "next" | "previous") => {
    const search = sideSearches[side];
    const requestedIndex = search.currentIndex + (target === "next" ? 1 : -1);
    const result = renderSideSearch(side, search.query, requestedIndex);
    setSideSearches((current) => ({
      ...current,
      [side]: { ...current[side], ...result },
    }));
  };

  const openSideSearch = (side: DiffSide) => {
    const search = sideSearches[side];
    setSideSearches((current) => ({
      ...current,
      [side]: { ...current[side], open: true },
    }));
    window.requestAnimationFrame(() => {
      const input = side === "original"
        ? originalSearchInputRef.current
        : modifiedSearchInputRef.current;
      input?.focus();
      input?.select();
      if (search.query) {
        const result = renderSideSearch(side, search.query, Math.max(search.currentIndex, 0));
        setSideSearches((current) => ({
          ...current,
          [side]: { ...current[side], ...result },
        }));
      }
    });
  };

  const closeSideSearch = (side: DiffSide) => {
    const editor = getSideEditor(side);
    if (editor) getSearchDecorations(side, editor).clear();
    setSideSearches((current) => ({
      ...current,
      [side]: { ...current[side], open: false },
    }));
  };

  useEffect(() => {
    viewModeRef.current = viewMode;
    if (editorRef.current) updateViewMode(editorRef.current, viewMode);
  }, [viewMode]);

  useEffect(() => {
    setDiffCount(0);
    originalSearchDecorationsRef.current?.clear();
    modifiedSearchDecorationsRef.current?.clear();
    originalSearchDecorationsRef.current = null;
    modifiedSearchDecorationsRef.current = null;
    setSideSearches({
      original: createInitialSideSearch(),
      modified: createInitialSideSearch(),
    });
  }, [diff?.modified, diff?.original, diff?.path]);

  useEffect(
    () => () => {
      diffUpdateListenerRef.current?.dispose();
      editorDisposeListenerRef.current?.dispose();
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
  const conflicted = isConflictedChange(selected);
  const textConflict = selected.item === "conflicted" && !selected.isDirectory;
  const conflictBlocks = conflicted && diff && !diff.isBinary
    ? countConflictBlocks(diff.modified)
    : 0;
  const conflictMessage = conflictBlocks
    ? `工作副本中检测到 ${conflictBlocks} 个冲突块；右侧会保留冲突标记，解决前无法提交。`
    : selected.treeConflicted
      ? "此项存在树冲突，请先确认文件或目录结构，再由 TortoiseSVN 标记解决。"
      : selected.properties === "conflicted"
        ? "此项存在 SVN 属性冲突，可展开下方属性差异并在确认后标记解决。"
        : "SVN 仍将此项标记为未解决冲突；请使用冲突编辑器处理后再提交。";
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
          {conflicted && (
            <span className="conflict-chip" title={conflictLabel(selected)}>
              <Icon name="conflict" size={12} />
              {conflictLabel(selected)}
            </span>
          )}
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

      {conflicted && (
        <div className="diff-conflict-banner" role="status">
          <span className="diff-conflict-icon"><Icon name="conflict" size={19} /></span>
          <div>
            <strong>{conflictLabel(selected)}尚未解决</strong>
            <span>{conflictMessage}</span>
          </div>
          <div className="diff-conflict-actions">
            {textConflict && (
              <button
                type="button"
                disabled={!tortoiseSvnAvailable}
                title={tortoiseSvnAvailable
                  ? "使用 TortoiseSVN 配置的三方合并工具打开"
                  : "未检测到 TortoiseSVN"}
                onClick={onOpenConflictEditor}
              >
                <Icon name="conflict" size={14} />
                打开冲突编辑器
              </button>
            )}
            <button
              type="button"
              disabled={!tortoiseSvnAvailable}
              title={tortoiseSvnAvailable
                ? "由 TortoiseSVN 再次确认后标记为已解决"
                : "未检测到 TortoiseSVN"}
              onClick={onMarkResolved}
            >
              <Icon name="check" size={14} />
              标记已解决…
            </button>
          </div>
        </div>
      )}

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
          {canSwitchView && (
            <div className="diff-tools-row with-overview">
              <button
                type="button"
                className={`diff-side-search-button original ${sideSearches.original.open ? "active" : ""}`}
                disabled={!editorReady}
                aria-pressed={sideSearches.original.open}
                title="展开 BASE 独立搜索栏"
                onClick={() => openSideSearch("original")}
              >
                <Icon name="search" size={13} />
                <span>搜索 BASE</span>
              </button>

              <div className="diff-change-navigation" role="group" aria-label="差异导航">
                <button
                  type="button"
                  disabled={!editorReady || !diffCount}
                  aria-label="上一个差异"
                  title="跳转到上一个差异"
                  onClick={() => navigateDiff("previous")}
                >
                  <Icon name="chevron" size={13} className="previous" />
                </button>
                <span aria-live="polite"><b>{diffCount}</b> 处差异</span>
                <button
                  type="button"
                  disabled={!editorReady || !diffCount}
                  aria-label="下一个差异"
                  title="跳转到下一个差异"
                  onClick={() => navigateDiff("next")}
                >
                  <Icon name="chevron" size={13} className="next" />
                </button>
              </div>

              <button
                type="button"
                className={`diff-side-search-button modified ${sideSearches.modified.open ? "active" : ""}`}
                disabled={!editorReady}
                aria-pressed={sideSearches.modified.open}
                title="展开工作副本独立搜索栏"
                onClick={() => openSideSearch("modified")}
              >
                <Icon name="search" size={13} />
                <span>搜索工作副本</span>
              </button>
            </div>
          )}
          {canSwitchView && (sideSearches.original.open || sideSearches.modified.open) && (
            <div className="diff-side-search-row with-overview">
              <div className="diff-side-search-slot original">
                {sideSearches.original.open && (
                  <div className="diff-side-search-field">
                    <Icon name="search" size={13} />
                    <input
                      ref={originalSearchInputRef}
                      type="text"
                      value={sideSearches.original.query}
                      placeholder="在 BASE 中搜索"
                      aria-label="在 BASE 中搜索"
                      spellCheck={false}
                      onChange={(event) => updateSideSearchQuery("original", event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") closeSideSearch("original");
                        else if (event.key === "Enter") {
                          event.preventDefault();
                          navigateSideSearch("original", event.shiftKey ? "previous" : "next");
                        }
                      }}
                    />
                    <span className="diff-search-count" aria-live="polite">
                      {sideSearches.original.query
                        ? sideSearches.original.matchCount
                          ? `${sideSearches.original.currentIndex + 1}/${sideSearches.original.matchCount}`
                          : "无结果"
                        : ""}
                    </span>
                    <button
                      type="button"
                      disabled={!sideSearches.original.matchCount}
                      aria-label="上一个 BASE 搜索结果"
                      title="上一个结果（Shift+Enter）"
                      onClick={() => navigateSideSearch("original", "previous")}
                    >
                      <Icon name="chevron" size={12} className="previous" />
                    </button>
                    <button
                      type="button"
                      disabled={!sideSearches.original.matchCount}
                      aria-label="下一个 BASE 搜索结果"
                      title="下一个结果（Enter）"
                      onClick={() => navigateSideSearch("original", "next")}
                    >
                      <Icon name="chevron" size={12} className="next" />
                    </button>
                    <button
                      type="button"
                      aria-label="关闭 BASE 搜索"
                      title="关闭搜索（Esc）"
                      onClick={() => closeSideSearch("original")}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )}
              </div>

              <div className="diff-side-search-slot modified">
                {sideSearches.modified.open && (
                  <div className="diff-side-search-field">
                    <Icon name="search" size={13} />
                    <input
                      ref={modifiedSearchInputRef}
                      type="text"
                      value={sideSearches.modified.query}
                      placeholder="在工作副本中搜索"
                      aria-label="在工作副本中搜索"
                      spellCheck={false}
                      onChange={(event) => updateSideSearchQuery("modified", event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") closeSideSearch("modified");
                        else if (event.key === "Enter") {
                          event.preventDefault();
                          navigateSideSearch("modified", event.shiftKey ? "previous" : "next");
                        }
                      }}
                    />
                    <span className="diff-search-count" aria-live="polite">
                      {sideSearches.modified.query
                        ? sideSearches.modified.matchCount
                          ? `${sideSearches.modified.currentIndex + 1}/${sideSearches.modified.matchCount}`
                          : "无结果"
                        : ""}
                    </span>
                    <button
                      type="button"
                      disabled={!sideSearches.modified.matchCount}
                      aria-label="上一个工作副本搜索结果"
                      title="上一个结果（Shift+Enter）"
                      onClick={() => navigateSideSearch("modified", "previous")}
                    >
                      <Icon name="chevron" size={12} className="previous" />
                    </button>
                    <button
                      type="button"
                      disabled={!sideSearches.modified.matchCount}
                      aria-label="下一个工作副本搜索结果"
                      title="下一个结果（Enter）"
                      onClick={() => navigateSideSearch("modified", "next")}
                    >
                      <Icon name="chevron" size={12} className="next" />
                    </button>
                    <button
                      type="button"
                      aria-label="关闭工作副本搜索"
                      title="关闭搜索（Esc）"
                      onClick={() => closeSideSearch("modified")}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )}
              </div>
              <span aria-hidden="true" />
            </div>
          )}
          <div className={`diff-side-labels ${canSwitchView ? "with-overview" : ""}`}>
            <div>
              <span>{diff.originalLabel}</span>
              <small>{diff.originalEncoding} · {formatBytes(diff.originalBytes)}</small>
            </div>
            <div>
              <span>{diff.modifiedLabel}{conflicted ? " · 冲突未解决" : ""}</span>
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
                  useInlineViewWhenSpaceIsLimited: false,
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
