import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ChangeEntry,
  CommitLaunchResult,
  DiffResult,
  FileFingerprint,
  ScanResult,
  ToolAvailability,
  TortoiseSvnAvailability,
} from "./types";
import { ChangesPanel } from "./components/ChangesPanel";
import { DiffPane } from "./components/DiffPane";
import { Icon } from "./components/Icons";
import type { ChangeItemAction } from "./changeItemActions";
import { DiffCache, sameFingerprint } from "./diffCache";
import { textDiffChanges } from "./textDiffFiles";
import {
  ancestorDirectorySelectionKeys,
  expandCommitSelectionKeys,
  reconcileCommitSelection,
  selectedCommitChanges,
} from "./commitSelection";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_DIFF_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_HANDLE_WIDTH,
  clampSidebarWidth,
  sidebarMaxWidth,
  sidebarWidthFromKey,
} from "./sidebarResize";

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

interface BulkDiffProgress {
  completed: number;
  total: number;
}

interface BulkDiffCounters {
  completed: number;
  loaded: number;
  reused: number;
  changed: number;
  binary: number;
  failed: number;
}

const DIFF_CACHE_LIMIT = 12;
const FILE_CHECK_INTERVAL_MS = 1500;
const BULK_DIFF_CONCURRENCY = 3;
const SIDEBAR_WIDTH_STORAGE_KEY = "svn-scope.sidebar-width";

function currentViewportWidth() {
  return Math.max(
    window.innerWidth,
    MIN_SIDEBAR_WIDTH + MIN_DIFF_WIDTH + SIDEBAR_RESIZE_HANDLE_WIDTH,
  );
}

function initialSidebarWidth() {
  let storedWidth = DEFAULT_SIDEBAR_WIDTH;
  try {
    const value = Number.parseFloat(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "");
    if (Number.isFinite(value)) storedWidth = value;
  } catch {
    // A disabled localStorage should not prevent the desktop UI from loading.
  }
  return clampSidebarWidth(storedWidth, currentViewportWidth());
}

function normalizedPath(path: string) {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("系统剪贴板拒绝了复制操作");
}

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
  const [bulkDiffProgress, setBulkDiffProgress] = useState<BulkDiffProgress>();
  const [commitSelection, setCommitSelection] = useState<Set<string>>(() => new Set());
  const [tortoiseSvn, setTortoiseSvn] = useState<TortoiseSvnAvailability>();
  const [commitLaunching, setCommitLaunching] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const diffCacheRef = useRef(new DiffCache(DIFF_CACHE_LIMIT));
  const selectedRef = useRef<ChangeEntry | undefined>(undefined);
  const watchBaselineRef = useRef<{ path: string; fingerprint: FileFingerprint } | undefined>(undefined);
  const pendingFileUpdateRef = useRef<PendingFileUpdate | undefined>(undefined);
  const bulkDiffRunRef = useRef(0);
  const bulkDiffRunningRef = useRef(false);
  const activeScanDirectoryRef = useRef<string | undefined>(undefined);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarDragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | undefined>(undefined);
  const eligibleTextChanges = useMemo(() => textDiffChanges(scan?.changes ?? []), [scan?.changes]);
  const commitChanges = useMemo(
    () => selectedCommitChanges(scan?.changes ?? [], commitSelection),
    [commitSelection, scan?.changes],
  );

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const previewSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampSidebarWidth(width, currentViewportWidth());
    sidebarWidthRef.current = nextWidth;
    workspaceRef.current?.style.setProperty("--sidebar-width", `${nextWidth}px`);
    return nextWidth;
  }, []);

  const applySidebarWidth = useCallback((width: number) => {
    const nextWidth = previewSidebarWidth(width);
    setSidebarWidth(nextWidth);
    return nextWidth;
  }, [previewSidebarWidth]);

  const persistSidebarWidth = useCallback((width: number) => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Resizing still works for this session when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const onWindowResize = () => applySidebarWidth(sidebarWidthRef.current);
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [applySidebarWidth]);

  const beginSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidthRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSidebarResizing(true);
  }, []);

  const moveSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    previewSidebarWidth(drag.startWidth + event.clientX - drag.startX);
  }, [previewSidebarWidth]);

  const endSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sidebarDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSidebarWidth(sidebarWidthRef.current);
    setSidebarResizing(false);
    persistSidebarWidth(sidebarWidthRef.current);
  }, [persistSidebarWidth]);

  const resizeSidebarFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nextWidth = sidebarWidthFromKey(
      sidebarWidthRef.current,
      event.key,
      event.shiftKey,
      currentViewportWidth(),
    );
    if (nextWidth === undefined) return;
    event.preventDefault();
    applySidebarWidth(nextWidth);
    persistSidebarWidth(nextWidth);
  }, [applySidebarWidth, persistSidebarWidth]);

  const resetSidebarWidth = useCallback(() => {
    const nextWidth = applySidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    persistSidebarWidth(nextWidth);
  }, [applySidebarWidth, persistSidebarWidth]);

  const storeDiffCache = useCallback((change: ChangeEntry, fingerprint: FileFingerprint, result: DiffResult) => {
    diffCacheRef.current.put(change, fingerprint, result);
  }, []);

  const requestFileReload = useCallback((change: ChangeEntry, fingerprint: FileFingerprint) => {
    const update = {
      path: change.path,
      relativePath: change.relativePath,
      fingerprint,
    };
    pendingFileUpdateRef.current = update;
    setPendingFileUpdate(update);
    setFileReloadError(undefined);
  }, []);

  const scanDirectory = useCallback(async (directory: string, preserveSelection = false) => {
    bulkDiffRunRef.current += 1;
    bulkDiffRunningRef.current = false;
    setBulkDiffProgress(undefined);
    const nextDirectory = normalizedPath(directory);
    const directoryChanged = activeScanDirectoryRef.current !== nextDirectory;
    if (directoryChanged) {
      activeScanDirectoryRef.current = nextDirectory;
      diffCacheRef.current.clear();
      diffCacheRef.current.setLimit(DIFF_CACHE_LIMIT);
    }
    setScanLoading(true);
    setScanError(undefined);
    setToast(undefined);
    try {
      const result = await invoke<ScanResult>("scan_changes", { directory });
      setScan(result);
      setCommitSelection((current) => directoryChanged
        ? new Set()
        : reconcileCommitSelection(current, result.changes));
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
      return result;
    } catch (error) {
      setScanError(errorMessage(error));
      if (!preserveSelection) {
        setScan(undefined);
        setSelected(undefined);
        setDiff(undefined);
        setCommitSelection(new Set());
      }
      return undefined;
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
    let active = true;
    invoke<TortoiseSvnAvailability>("get_tortoise_svn_availability")
      .then((availability) => {
        if (active) setTortoiseSvn(availability);
      })
      .catch(() => {
        if (active) {
          setTortoiseSvn({
            available: false,
            path: null,
            autoSelectFiles: true,
            showUnversioned: true,
          });
        }
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
          requestFileReload(change, finalFingerprint);
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
  }, [requestFileReload, selected, storeDiffCache]);

  useEffect(() => {
    if (!selected || selected.isDirectory || !diff) return;
    let active = true;
    const path = selected.path;

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
          requestFileReload(selected, fingerprint);
        }
        return;
      }

      const baseline = watchBaselineRef.current;
      if (!baseline || baseline.path !== path) {
        watchBaselineRef.current = { path, fingerprint };
        return;
      }
      if (!sameFingerprint(baseline.fingerprint, fingerprint)) {
        requestFileReload(selected, fingerprint);
      }
    };

    const timer = window.setInterval(() => void checkForUpdate(), FILE_CHECK_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [diff, requestFileReload, selected]);

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

  const updateAllTextDiffs = useCallback(async () => {
    if (bulkDiffRunningRef.current) return;
    if (!eligibleTextChanges.length) {
      setToast("当前修改中没有符合白名单的代码文本文件");
      return;
    }

    const runId = bulkDiffRunRef.current + 1;
    bulkDiffRunRef.current = runId;
    bulkDiffRunningRef.current = true;
    diffCacheRef.current.setLimit(Math.max(
      DIFF_CACHE_LIMIT,
      eligibleTextChanges.length + DIFF_CACHE_LIMIT,
    ));
    setToast(undefined);
    setBulkDiffProgress({ completed: 0, total: eligibleTextChanges.length });

    const counters: BulkDiffCounters = {
      completed: 0,
      loaded: 0,
      reused: 0,
      changed: 0,
      binary: 0,
      failed: 0,
    };
    let nextIndex = 0;
    let lastProgressUpdate = 0;

    const isCurrentRun = () => bulkDiffRunRef.current === runId;
    const finishOne = () => {
      counters.completed += 1;
      const now = Date.now();
      if (
        isCurrentRun()
        && (counters.completed === eligibleTextChanges.length || now - lastProgressUpdate >= 100)
      ) {
        lastProgressUpdate = now;
        setBulkDiffProgress({
          completed: counters.completed,
          total: eligibleTextChanges.length,
        });
      }
    };

    const processChange = async (change: ChangeEntry) => {
      try {
        const initialFingerprint = await getFileFingerprint(change.path);
        if (!isCurrentRun()) return;

        const cached = diffCacheRef.current.get(change, initialFingerprint);
        if (cached) {
          counters.reused += 1;
          return;
        }

        if (selectedRef.current?.path === change.path) {
          const pending = pendingFileUpdateRef.current;
          const baseline = watchBaselineRef.current;
          if (pending?.path === change.path) {
            counters.changed += 1;
            return;
          }
          if (
            baseline
            && baseline.path === change.path
            && !sameFingerprint(baseline.fingerprint, initialFingerprint)
          ) {
            requestFileReload(change, initialFingerprint);
            counters.changed += 1;
            return;
          }
        }

        const result = await getFileDiff(change);
        if (!isCurrentRun()) return;
        const finalFingerprint = await getFileFingerprint(change.path);
        if (!isCurrentRun()) return;

        if (!sameFingerprint(initialFingerprint, finalFingerprint)) {
          if (selectedRef.current?.path === change.path) {
            requestFileReload(change, finalFingerprint);
          }
          counters.changed += 1;
          return;
        }
        if (result.isBinary) {
          counters.binary += 1;
          return;
        }

        if (selectedRef.current?.path === change.path) {
          const pending = pendingFileUpdateRef.current;
          const baseline = watchBaselineRef.current;
          if (pending?.path === change.path) {
            counters.changed += 1;
            return;
          }
          if (
            baseline
            && baseline.path === change.path
            && !sameFingerprint(baseline.fingerprint, finalFingerprint)
          ) {
            requestFileReload(change, finalFingerprint);
            counters.changed += 1;
            return;
          }
        }

        storeDiffCache(change, finalFingerprint, result);
        counters.loaded += 1;
      } catch {
        if (isCurrentRun()) counters.failed += 1;
      }
    };

    const worker = async () => {
      while (isCurrentRun()) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= eligibleTextChanges.length) return;
        await processChange(eligibleTextChanges[index]);
        if (!isCurrentRun()) return;
        finishOne();
      }
    };

    const workerCount = Math.min(BULK_DIFF_CONCURRENCY, eligibleTextChanges.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (!isCurrentRun()) return;

    bulkDiffRunningRef.current = false;
    setBulkDiffProgress(undefined);
    const details = [
      `新读取 ${counters.loaded}`,
      `沿用缓存 ${counters.reused}`,
    ];
    if (counters.changed) details.push(`变化中跳过 ${counters.changed}`);
    if (counters.binary) details.push(`二进制跳过 ${counters.binary}`);
    if (counters.failed) details.push(`失败 ${counters.failed}`);
    setToast(`文本 Diff 更新完成：${details.join("，")}`);
  }, [eligibleTextChanges, requestFileReload, storeDiffCache]);

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

  const refresh = useCallback(async () => {
    if (!scan?.directory || scanLoading) return;
    const result = await scanDirectory(scan.directory, true);
    if (result) setToast(`已刷新当前目录：${result.changes.length} 项变更`);
  }, [scan, scanDirectory, scanLoading]);

  const toggleCommitSelection = useCallback((targets: ChangeEntry[], checked: boolean) => {
    if (!scan) return;
    const affected = expandCommitSelectionKeys(scan.changes, targets);
    const broadDirectoryTargets = checked
      ? new Set<string>()
      : ancestorDirectorySelectionKeys(scan.changes, targets);
    setCommitSelection((current) => {
      const next = new Set(current);
      for (const key of affected) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      for (const key of broadDirectoryTargets) next.delete(key);
      return next;
    });
  }, [scan]);

  const clearCommitSelection = useCallback(() => {
    setCommitSelection(new Set());
  }, []);

  const launchTortoiseCommit = useCallback(async (paths: string[]) => {
    if (!scan || !paths.length || commitLaunching) return;
    setCommitLaunching(true);
    setToast(undefined);
    try {
      const result = await invoke<CommitLaunchResult>("open_tortoise_svn_commit", {
        paths,
        directory: scan.directory,
        wcRoot: scan.wcRoot,
      });
      setToast(result.message);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setCommitLaunching(false);
    }
  }, [commitLaunching, scan]);

  const openTortoiseCommit = useCallback(async () => {
    await launchTortoiseCommit(commitChanges.map((change) => change.path));
  }, [commitChanges, launchTortoiseCommit]);

  const handleItemAction = useCallback(async (action: ChangeItemAction, change: ChangeEntry) => {
    if (!scan) return;
    setToast(undefined);
    try {
      if (action === "copyRelativePath" || action === "copyFullPath") {
        const value = action === "copyRelativePath" ? change.relativePath : change.path;
        await copyText(value);
        setToast(`已复制${action === "copyRelativePath" ? "相对" : "完整"}路径：${value}`);
        return;
      }

      if (action === "commit") {
        await launchTortoiseCommit([change.path]);
        return;
      }

      const command = action === "open" || action === "reveal"
        ? "open_change_path"
        : "open_tortoise_svn_action";
      const message = await invoke<string>(command, {
        action,
        path: change.path,
        directory: scan.directory,
        wcRoot: scan.wcRoot,
      });
      setToast(message);
    } catch (error) {
      setToast(errorMessage(error));
    }
  }, [launchTortoiseCommit, scan]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "r") {
        event.preventDefault();
        void refresh();
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
    <main className={`app-shell ${sidebarResizing ? "sidebar-resizing" : ""}`}>
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
          <button
            type="button"
            className="toolbar-button refresh-toolbar-button"
            onClick={() => void refresh()}
            disabled={!scan || scanLoading}
            title="重新扫描当前打开目录的本地变更 (Ctrl+R)"
          >
            <Icon name="refresh" size={17} className={scanLoading ? "rotating" : ""} />
            {scanLoading ? "正在刷新…" : "刷新变更"}
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
        <div
          ref={workspaceRef}
          className="workspace"
          style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        >
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
              directory={scan.directory}
              changes={scan.changes}
              selectedPath={selected?.path}
              selectedCommitPaths={commitSelection}
              tortoiseSvn={tortoiseSvn}
              commitLaunching={commitLaunching}
              textDiffCount={eligibleTextChanges.length}
              bulkDiffProgress={bulkDiffProgress}
              onSelect={setSelected}
              onToggleCommitSelection={toggleCommitSelection}
              onClearCommitSelection={clearCommitSelection}
              onCommitSelection={() => void openTortoiseCommit()}
              onUpdateAllTextDiffs={() => void updateAllTextDiffs()}
              onItemAction={(action, change) => void handleItemAction(action, change)}
            />
          </aside>

          <div
            className="sidebar-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="调整修改列表宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={Math.min(MAX_SIDEBAR_WIDTH, sidebarMaxWidth(currentViewportWidth()))}
            aria-valuenow={sidebarWidth}
            aria-valuetext={`${sidebarWidth} 像素`}
            title="拖动调整左侧宽度；双击恢复默认；方向键可微调"
            onPointerDown={beginSidebarResize}
            onPointerMove={moveSidebarResize}
            onPointerUp={endSidebarResize}
            onPointerCancel={endSidebarResize}
            onLostPointerCapture={endSidebarResize}
            onKeyDown={resizeSidebarFromKeyboard}
            onDoubleClick={resetSidebarWidth}
          >
            <span className="sidebar-resize-grip" aria-hidden="true" />
          </div>

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
              tortoiseSvnAvailable={tortoiseSvn?.available ?? false}
              onOpenConflictEditor={() => {
                if (selected) void handleItemAction("conflictEditor", selected);
              }}
              onMarkResolved={() => {
                if (selected) void handleItemAction("resolve", selected);
              }}
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
        {scan && (
          <span className={tortoiseSvn?.available ? "tool-ready" : "tool-muted"}>
            <span className="tiny-dot" />
            TortoiseSVN {!tortoiseSvn ? "检测中" : tortoiseSvn.available ? "可用" : "未检测到"}
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
