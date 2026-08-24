import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ChangeEntry,
  DiffResult,
  FileFingerprint,
  ScanResult,
  ToolAvailability,
} from "./types";
import { ChangesPanel } from "./components/ChangesPanel";
import { DiffPane } from "./components/DiffPane";
import { Icon } from "./components/Icons";
import { DiffCache, sameFingerprint } from "./diffCache";

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

interface PropertyDiffState {
  path: string;
  loading: boolean;
  loaded: boolean;
  value?: string | null;
  error?: string;
}

interface PendingFileUpdate {
  path: string;
  relativePath: string;
  fingerprint: FileFingerprint;
}

const DIFF_CACHE_LIMIT = 12;
const FILE_CHECK_INTERVAL_MS = 1500;

function getFileFingerprint(path: string) {
  return invoke<FileFingerprint>("get_file_fingerprint", { path });
}

function getFileDiff(change: ChangeEntry) {
  return invoke<DiffResult>("get_file_diff", {
    path: change.path,
    item: change.item,
    isDirectory: change.isDirectory,
    baseRevision: change.baseRevision,
  });
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
  const [beyondCompare, setBeyondCompare] = useState<ToolAvailability>();
  const [propertyDiffState, setPropertyDiffState] = useState<PropertyDiffState>();
  const [pendingFileUpdate, setPendingFileUpdate] = useState<PendingFileUpdate>();
  const [fileReloading, setFileReloading] = useState(false);
  const [fileReloadError, setFileReloadError] = useState<string>();
  const diffCacheRef = useRef(new DiffCache(DIFF_CACHE_LIMIT));
  const selectedRef = useRef<ChangeEntry | undefined>(undefined);
  const watchBaselineRef = useRef<{ path: string; fingerprint: FileFingerprint } | undefined>(undefined);
  const pendingFileUpdateRef = useRef<PendingFileUpdate | undefined>(undefined);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const storeDiffCache = useCallback((change: ChangeEntry, fingerprint: FileFingerprint, result: DiffResult) => {
    diffCacheRef.current.put(change, fingerprint, result);
  }, []);

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
    let active = true;
    invoke<ToolAvailability>("get_beyond_compare_availability")
      .then((availability) => {
        if (active) setBeyondCompare(availability);
      })
      .catch(() => {
        if (active) setBeyondCompare({ available: false, path: null });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPropertyDiffState(undefined);
    setPendingFileUpdate(undefined);
    pendingFileUpdateRef.current = undefined;
    watchBaselineRef.current = undefined;
    setFileReloading(false);
    setFileReloadError(undefined);
    if (!selected) {
      setDiff(undefined);
      setDiffError(undefined);
      setDiffLoading(false);
      return;
    }

    let active = true;
    const change = selected;
    setDiffLoading(false);
    setDiffError(undefined);

    const load = async () => {
      let fingerprint: FileFingerprint | undefined;
      try {
        fingerprint = await getFileFingerprint(change.path);
      } catch {
        fingerprint = undefined;
      }
      if (!active) return;

      const cached = fingerprint ? diffCacheRef.current.get(change, fingerprint) : undefined;
      if (fingerprint && cached) {
        watchBaselineRef.current = { path: change.path, fingerprint };
        setDiff(cached);
        return;
      }

      setDiffLoading(true);
      setDiff(undefined);
      try {
        const result = await getFileDiff(change);
        if (!active) return;

        let finalFingerprint = fingerprint;
        try {
          finalFingerprint = await getFileFingerprint(change.path);
        } catch {
          finalFingerprint = undefined;
        }
        if (!active) return;
        if (
          fingerprint
          && finalFingerprint
          && !sameFingerprint(fingerprint, finalFingerprint)
        ) {
          watchBaselineRef.current = { path: change.path, fingerprint };
          const update = {
            path: change.path,
            relativePath: change.relativePath,
            fingerprint: finalFingerprint,
          };
          pendingFileUpdateRef.current = update;
          setPendingFileUpdate(update);
        } else if (finalFingerprint) {
          storeDiffCache(change, finalFingerprint, result);
          watchBaselineRef.current = { path: change.path, fingerprint: finalFingerprint };
        }
        setDiff(result);
      } catch (error) {
        if (active) setDiffError(errorMessage(error));
      } finally {
        if (active) setDiffLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [selected, storeDiffCache]);

  useEffect(() => {
    if (!selected || selected.isDirectory || !diff) return;
    let active = true;
    const path = selected.path;
    const relativePath = selected.relativePath;

    const checkForUpdate = async () => {
      let fingerprint: FileFingerprint;
      try {
        fingerprint = await getFileFingerprint(path);
      } catch {
        return;
      }
      if (!active || selectedRef.current?.path !== path) return;

      const pending = pendingFileUpdateRef.current;
      if (pending?.path === path) {
        if (!sameFingerprint(pending.fingerprint, fingerprint)) {
          const updated = { path, relativePath, fingerprint };
          pendingFileUpdateRef.current = updated;
          setPendingFileUpdate(updated);
          setFileReloadError(undefined);
        }
        return;
      }

      const baseline = watchBaselineRef.current;
      if (!baseline || baseline.path !== path) {
        watchBaselineRef.current = { path, fingerprint };
        return;
      }
      if (!sameFingerprint(baseline.fingerprint, fingerprint)) {
        const update = { path, relativePath, fingerprint };
        pendingFileUpdateRef.current = update;
        setPendingFileUpdate(update);
        setFileReloadError(undefined);
      }
    };

    const timer = window.setInterval(() => void checkForUpdate(), FILE_CHECK_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [diff, selected]);

  const keepCurrentDiff = useCallback(() => {
    const update = pendingFileUpdateRef.current;
    if (update) {
      watchBaselineRef.current = { path: update.path, fingerprint: update.fingerprint };
    }
    pendingFileUpdateRef.current = undefined;
    setPendingFileUpdate(undefined);
    setFileReloadError(undefined);
  }, []);

  const reloadUpdatedFile = useCallback(async () => {
    const update = pendingFileUpdateRef.current;
    const change = selectedRef.current;
    if (!update || !change || update.path !== change.path) {
      pendingFileUpdateRef.current = undefined;
      setPendingFileUpdate(undefined);
      return;
    }

    setFileReloading(true);
    setFileReloadError(undefined);
    try {
      const result = await getFileDiff(change);
      let fingerprint = update.fingerprint;
      try {
        fingerprint = await getFileFingerprint(change.path);
      } catch {
        // The update fingerprint still safely invalidates the previous cache entry.
      }
      if (selectedRef.current?.path !== change.path) return;

      if (!sameFingerprint(update.fingerprint, fingerprint)) {
        const nextUpdate = {
          path: change.path,
          relativePath: change.relativePath,
          fingerprint,
        };
        pendingFileUpdateRef.current = nextUpdate;
        setPendingFileUpdate(nextUpdate);
        setFileReloadError("文件在重新读取期间再次发生变化，请再次重新加载。");
        return;
      }

      storeDiffCache(change, fingerprint, result);
      watchBaselineRef.current = { path: change.path, fingerprint };
      setDiffError(undefined);
      setDiff(result);
      setPropertyDiffState(undefined);
      pendingFileUpdateRef.current = undefined;
      setPendingFileUpdate(undefined);
    } catch (error) {
      if (selectedRef.current?.path === change.path) {
        setFileReloadError(errorMessage(error));
      }
    } finally {
      setFileReloading(false);
    }
  }, [storeDiffCache]);

  const loadPropertyDiff = useCallback(() => {
    if (!selected || !["modified", "conflicted"].includes(selected.properties)) return;
    if (
      propertyDiffState?.path === selected.path
      && (propertyDiffState.loading || (propertyDiffState.loaded && !propertyDiffState.error))
    ) return;

    const path = selected.path;
    setPropertyDiffState({ path, loading: true, loaded: false });
    void invoke<string | null>("get_property_diff", { path })
      .then((value) => {
        setPropertyDiffState((current) => current?.path === path
          ? { path, loading: false, loaded: true, value }
          : current);
      })
      .catch((error) => {
        setPropertyDiffState((current) => current?.path === path
          ? { path, loading: false, loaded: true, error: errorMessage(error) }
          : current);
      });
  }, [propertyDiffState, selected]);

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
  const activePropertyDiff = propertyDiffState?.path === selected?.path
    ? propertyDiffState
    : undefined;

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
              beyondCompareAvailable={beyondCompare?.available ?? false}
              beyondComparePath={beyondCompare?.path}
              onOpenBeyondCompare={() => void openBeyondCompare()}
              propertyDiff={activePropertyDiff?.value}
              propertyDiffLoading={activePropertyDiff?.loading ?? false}
              propertyDiffLoaded={activePropertyDiff?.loaded ?? false}
              propertyDiffError={activePropertyDiff?.error}
              onLoadPropertyDiff={loadPropertyDiff}
            />
          </div>
        </div>
      )}

      <footer className="statusbar">
        <span>{scan ? `SVN ${scan.svnVersion}` : "就绪"}</span>
        {scan?.revision && <span>工作副本 r{scan.revision}</span>}
        <span className="statusbar-spacer" />
        {scan && (
          <span className={beyondCompare?.available ? "tool-ready" : "tool-muted"}>
            <span className="tiny-dot" />
            Beyond Compare {!beyondCompare ? "检测中" : beyondCompare.available ? "可用" : "未检测到"}
          </span>
        )}
        <span>本地模式</span>
      </footer>

      {pendingFileUpdate && (
        <div className="file-update-backdrop">
          <section
            className="file-update-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="file-update-title"
            aria-describedby="file-update-description"
          >
            <div className="file-update-icon"><Icon name="warning" size={22} /></div>
            <div className="file-update-content">
              <h2 id="file-update-title">文件已更新</h2>
              <p id="file-update-description">
                <strong title={pendingFileUpdate.path}>{pendingFileUpdate.relativePath}</strong>
                已在磁盘上发生变化。是否重新读取并刷新当前 Diff？
              </p>
              {fileReloadError && <div className="file-update-error">{fileReloadError}</div>}
              <div className="file-update-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={fileReloading}
                  onClick={keepCurrentDiff}
                >
                  暂不重载
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={fileReloading}
                  onClick={() => void reloadUpdatedFile()}
                >
                  {fileReloading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
                  {fileReloading ? "正在重新读取…" : "重新加载"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
