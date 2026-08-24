import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChangeEntry, DiffResult, ScanResult } from "./types";
import { ChangesPanel } from "./components/ChangesPanel";
import { DiffPane } from "./components/DiffPane";
import { Icon } from "./components/Icons";

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function folderName(path?: string) {
  if (!path) return "未打开目录";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || path;
}

export default function App() {
  const [scan, setScan] = useState<ScanResult>();
  const [selected, setSelected] = useState<ChangeEntry>();
  const [diff, setDiff] = useState<DiffResult>();
  const [scanLoading, setScanLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [diffError, setDiffError] = useState<string>();
  const [toast, setToast] = useState<string>();

  const scanDirectory = useCallback(async (directory: string, preserveSelection = false) => {
    setScanLoading(true);
    setScanError(undefined);
    setToast(undefined);
    try {
      const result = await invoke<ScanResult>("scan_changes", { directory });
      setScan(result);
      setSelected((current) => {
        if (preserveSelection && current) {
          const retained = result.changes.find((change) => change.path === current.path);
          if (retained) return retained;
        }
        return result.changes[0];
      });
      if (!result.changes.length) {
        setDiff(undefined);
        setDiffError(undefined);
      }
    } catch (error) {
      setScanError(errorMessage(error));
      setScan(undefined);
      setSelected(undefined);
      setDiff(undefined);
    } finally {
      setScanLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    invoke<string | null>("get_launch_directory")
      .then((directory) => {
        if (active && directory) void scanDirectory(directory);
      })
      .catch((error) => active && setScanError(errorMessage(error)));
    return () => {
      active = false;
    };
  }, [scanDirectory]);

  useEffect(() => {
    if (!selected) {
      setDiff(undefined);
      setDiffError(undefined);
      return;
    }
    let active = true;
    setDiffLoading(true);
    setDiffError(undefined);
    setDiff(undefined);
    invoke<DiffResult>("get_file_diff", {
      path: selected.path,
      item: selected.item,
      properties: selected.properties,
    })
      .then((result) => active && setDiff(result))
      .catch((error) => active && setDiffError(errorMessage(error)))
      .finally(() => active && setDiffLoading(false));
    return () => {
      active = false;
    };
  }, [selected]);

  const chooseDirectory = useCallback(async () => {
    const selectedDirectory = await open({
      directory: true,
      multiple: false,
      title: "选择 SVN 工作副本内的目录",
    });
    if (typeof selectedDirectory === "string") {
      await scanDirectory(selectedDirectory);
    }
  }, [scanDirectory]);

  const refresh = useCallback(() => {
    if (scan?.directory && !scanLoading) void scanDirectory(scan.directory, true);
  }, [scan, scanDirectory, scanLoading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "r") {
        event.preventDefault();
        refresh();
      }
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "o") {
        event.preventDefault();
        void chooseDirectory();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseDirectory, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openBeyondCompare = async () => {
    if (!selected) return;
    try {
      const message = await invoke<string>("open_in_beyond_compare", {
        path: selected.path,
        item: selected.item,
      });
      setToast(message);
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const rootIsScope = scan?.directory === scan?.wcRoot;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon"><Icon name="app" size={19} /></span>
          <span>SVN Scope</span>
        </div>
        <div className="project-title" title={scan?.directory}>
          {scan && <span className="project-dot" />}
          <strong>{folderName(scan?.directory)}</strong>
          {scan && <span className="change-total">{scan.changes.length} 项变更</span>}
        </div>
        <div className="top-actions">
          <button type="button" className="toolbar-button" onClick={() => void chooseDirectory()} title="打开目录 (Ctrl+O)">
            <Icon name="open" size={16} />
            打开目录
          </button>
          <button type="button" className="icon-button" onClick={refresh} disabled={!scan || scanLoading} title="刷新 (Ctrl+R)">
            <Icon name="refresh" size={17} className={scanLoading ? "rotating" : ""} />
          </button>
        </div>
      </header>

      {!scan ? (
        <section className="welcome">
          <div className="welcome-card">
            <div className="welcome-mark"><Icon name="app" size={46} /></div>
            <h1>只看这一层以下的 SVN 修改</h1>
            <p>从资源管理器右键目录打开，或在这里选择 SVN 工作副本内的任意目录。不会包含父目录的变更，也没有暂存区。</p>
            <button type="button" className="primary-button welcome-button" onClick={() => void chooseDirectory()} disabled={scanLoading}>
              {scanLoading ? <span className="spinner" /> : <Icon name="open" size={17} />}
              {scanLoading ? "正在扫描…" : "选择 SVN 目录"}
            </button>
            {scanError && (
              <div className="inline-error welcome-error">
                <Icon name="warning" size={20} />
                <span>{scanError}</span>
              </div>
            )}
            <div className="welcome-hint">快捷键 Ctrl+O 打开目录 · Ctrl+R 刷新</div>
          </div>
        </section>
      ) : (
        <div className="workspace">
          <aside className="sidebar">
            <div className="scope-block">
              <div className="scope-heading">
                <Icon name="repository" size={16} />
                <span>{rootIsScope ? "工作副本" : "当前范围"}</span>
              </div>
              <strong title={scan.directory}>{folderName(scan.directory)}</strong>
              <span className="scope-path" title={scan.directory}>{scan.directory}</span>
              {!rootIsScope && <span className="scope-rule">仅此目录及子目录</span>}
            </div>

            <ChangesPanel
              changes={scan.changes}
              selectedPath={selected?.path}
              onSelect={setSelected}
            />
          </aside>

          <div className="content">
            {scanError && <div className="scan-banner"><Icon name="warning" size={16} />{scanError}</div>}
            <DiffPane
              selected={selected}
              diff={diff}
              loading={diffLoading}
              error={diffError}
              beyondCompareAvailable={scan.beyondCompare.available}
              beyondComparePath={scan.beyondCompare.path}
              onOpenBeyondCompare={() => void openBeyondCompare()}
            />
          </div>
        </div>
      )}

      <footer className="statusbar">
        <span>{scan ? `SVN ${scan.svnVersion}` : "就绪"}</span>
        {scan?.revision && <span>工作副本 r{scan.revision}</span>}
        <span className="statusbar-spacer" />
        {scan && (
          <span className={scan.beyondCompare.available ? "tool-ready" : "tool-muted"}>
            <span className="tiny-dot" />
            Beyond Compare {scan.beyondCompare.available ? "可用" : "未检测到"}
          </span>
        )}
        <span>本地模式</span>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
