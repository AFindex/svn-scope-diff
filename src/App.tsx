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
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ChangeEntry,
  CommitLaunchResult,
  DiffResult,
  FileFingerprint,
  ScanResult,
  ScanPatch,
  SvnUpdateFinished,
  SvnUpdateStatus,
  ToolAvailability,
  TortoiseSvnAvailability,
  WorkingCopyChanged,
  WorkingCopyWatchError,
  WorkingCopyWatcherStatus,
} from "./types";
import { ChangesPanel } from "./components/ChangesPanel";
import { ChangeContextMenu } from "./components/ChangeContextMenu";
import { DiffPane } from "./components/DiffPane";
import { Icon } from "./components/Icons";
import type { ChangeItemAction } from "./changeItemActions";
import { DiffCache, sameFingerprint } from "./diffCache";
import { textDiffChanges } from "./textDiffFiles";
import { mergeScanPatch, patchTouchesPath, relativeChangePath } from "./scanPatch";
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

interface ScopeContextMenuState {
  change: ChangeEntry;
  x: number;
  y: number;
  returnFocus?: HTMLElement;
}

const DIFF_CACHE_LIMIT = 12;
const FILE_CHECK_INTERVAL_MS = 1500;
const BULK_DIFF_CONCURRENCY = 3;
const SIDEBAR_WIDTH_STORAGE_KEY = "svn-scope.sidebar-width";

function idleSvnUpdateStatus(): SvnUpdateStatus {
  return {
    running: false,
    updateId: null,
    pid: null,
    directories: [],
    cancelRequested: false,
  };
}

function scopeSetKey(directories: readonly string[]) {
  return directories.map(normalizedPath).sort().join("|");
}

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

function scopeDirectoryChange(directory: string, scan: ScanResult): ChangeEntry {
  return {
    path: directory,
    relativePath: relativeChangePath(directory, scan.directory),
    name: folderName(directory),
    item: "normal",
    properties: "none",
    statusCode: "•",
    isDirectory: true,
    treeConflicted: false,
    baseRevision: scan.revision,
    contextOnly: true,
    refreshPaths: [directory],
  };
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
  const [svnUpdate, setSvnUpdate] = useState<SvnUpdateStatus>(idleSvnUpdateStatus);
  const [svnUpdateLaunching, setSvnUpdateLaunching] = useState(false);
  const [watcherStatus, setWatcherStatus] = useState<WorkingCopyWatcherStatus>();
  const [autoRefreshBusy, setAutoRefreshBusy] = useState(false);
  const [autoRefreshError, setAutoRefreshError] = useState<string>();
  const [partialScanLoading, setPartialScanLoading] = useState(false);
  const [scopeContextMenu, setScopeContextMenu] = useState<ScopeContextMenuState>();
  const diffCacheRef = useRef(new DiffCache(DIFF_CACHE_LIMIT));
  const scanRef = useRef<ScanResult | undefined>(undefined);
  const selectedRef = useRef<ChangeEntry | undefined>(undefined);
  const watchBaselineRef = useRef<{ path: string; fingerprint: FileFingerprint } | undefined>(undefined);
  const pendingFileUpdateRef = useRef<PendingFileUpdate | undefined>(undefined);
  const bulkDiffRunRef = useRef(0);
  const bulkDiffRunningRef = useRef(false);
  const activeScanDirectoryRef = useRef<string | undefined>(undefined);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const finishedUpdateIdsRef = useRef(new Set<number>());
  const watcherIdRef = useRef<number | null>(null);
  const scanLoadingRef = useRef(false);
  const svnUpdateRunningRef = useRef(false);
  const pendingAutoRefreshPathsRef = useRef(new Map<string, string>());
  const autoRefreshRunningRef = useRef(false);
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

  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);

  useEffect(() => {
    scanLoadingRef.current = scanLoading;
  }, [scanLoading]);

  useEffect(() => {
    svnUpdateRunningRef.current = svnUpdate.running;
  }, [svnUpdate.running]);

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

  const scanDirectory = useCallback(async (
    directoryOrDirectories: string | string[],
    preserveSelection = false,
  ) => {
    const directories = Array.isArray(directoryOrDirectories)
      ? directoryOrDirectories
      : [directoryOrDirectories];
    bulkDiffRunRef.current += 1;
    bulkDiffRunningRef.current = false;
    setBulkDiffProgress(undefined);
    const nextDirectory = scopeSetKey(directories);
    const directoryChanged = activeScanDirectoryRef.current !== nextDirectory;
    if (directoryChanged) {
      diffCacheRef.current.clear();
      diffCacheRef.current.setLimit(DIFF_CACHE_LIMIT);
    }
    setScanLoading(true);
    setScanError(undefined);
    setToast(undefined);
    try {
      const result = await invoke<ScanResult>("scan_changes", { directories });
      activeScanDirectoryRef.current = scopeSetKey(result.scopeDirectories);
      scanRef.current = result;
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
        scanRef.current = undefined;
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

  const applyScanPatch = useCallback((patch: ScanPatch) => {
    const current = scanRef.current;
    if (!current || !patch.roots.length) return current;

    const changes = mergeScanPatch(current.changes, patch);
    const updated = { ...current, changes };
    scanRef.current = updated;
    setScan(updated);
    setCommitSelection((selection) => reconcileCommitSelection(selection, changes));

    const currentSelected = selectedRef.current;
    const nextSelected = currentSelected
      ? changes.find((change) => normalizedPath(change.path) === normalizedPath(currentSelected.path))
        ?? changes[0]
      : changes[0];
    selectedRef.current = nextSelected;
    setSelected(nextSelected);
    if (!nextSelected) {
      setDiff(undefined);
      setDiffError(undefined);
    } else if (
      currentSelected
      && normalizedPath(currentSelected.path) === normalizedPath(nextSelected.path)
      && patchTouchesPath(patch, currentSelected.path)
    ) {
      // Do not silently replace an open diff. The existing fingerprint watcher
      // asks the user whether the changed working file should be reloaded.
      setPropertyDiffState(undefined);
    }
    return updated;
  }, []);

  const refreshChangedPaths = useCallback(async (paths: string[], announce: boolean) => {
    const current = scanRef.current;
    if (!current || !paths.length || svnUpdateRunningRef.current) return undefined;
    if (announce) setPartialScanLoading(true);
    try {
      const patch = await invoke<ScanPatch>("scan_changed_paths", {
        scopeDirectories: current.scopeDirectories,
        paths,
        displayRoot: current.directory,
        wcRoot: current.wcRoot,
      });
      const latest = scanRef.current;
      if (!latest || scopeSetKey(latest.scopeDirectories) !== scopeSetKey(current.scopeDirectories)) {
        return undefined;
      }
      const updated = applyScanPatch(patch);
      if (announce && updated) {
        setToast(`局部刷新完成：当前共 ${updated.changes.length} 项变更`);
      }
      return updated;
    } catch (error) {
      const message = errorMessage(error);
      if (announce) setToast(message);
      else setAutoRefreshError(message);
      return undefined;
    } finally {
      if (announce) setPartialScanLoading(false);
    }
  }, [applyScanPatch]);

  const flushAutoRefreshQueue = useCallback(async () => {
    if (autoRefreshRunningRef.current) return;
    autoRefreshRunningRef.current = true;
    setAutoRefreshBusy(true);
    try {
      while (
        pendingAutoRefreshPathsRef.current.size
        && !scanLoadingRef.current
        && !svnUpdateRunningRef.current
      ) {
        const paths = [...pendingAutoRefreshPathsRef.current.values()];
        pendingAutoRefreshPathsRef.current.clear();
        await refreshChangedPaths(paths, false);
      }
    } finally {
      autoRefreshRunningRef.current = false;
      setAutoRefreshBusy(false);
    }
  }, [refreshChangedPaths]);

  useEffect(() => {
    let active = true;
    let unlistenChanged: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const setup = async () => {
      const [stopChanged, stopError] = await Promise.all([
        listen<WorkingCopyChanged>("working-copy-changed", (event) => {
          if (
            event.payload.watcherId !== watcherIdRef.current
            || scanLoadingRef.current
            || svnUpdateRunningRef.current
          ) return;
          for (const path of event.payload.paths) {
            pendingAutoRefreshPathsRef.current.set(normalizedPath(path), path);
          }
          void flushAutoRefreshQueue();
        }),
        listen<WorkingCopyWatchError>("working-copy-watch-error", (event) => {
          if (event.payload.watcherId === watcherIdRef.current) {
            setAutoRefreshError(event.payload.message);
          }
        }),
      ]);
      if (!active) {
        stopChanged();
        stopError();
        return;
      }
      unlistenChanged = stopChanged;
      unlistenError = stopError;
    };

    void setup().catch((error) => setAutoRefreshError(errorMessage(error)));
    return () => {
      active = false;
      unlistenChanged?.();
      unlistenError?.();
    };
  }, [flushAutoRefreshQueue]);

  const activeScopeKey = scan ? scopeSetKey(scan.scopeDirectories) : "";
  useEffect(() => {
    let active = true;
    const current = scanRef.current;
    if (!current || svnUpdate.running) {
      watcherIdRef.current = null;
      setWatcherStatus(undefined);
      pendingAutoRefreshPathsRef.current.clear();
      void invoke<WorkingCopyWatcherStatus>("stop_working_copy_watcher").catch(() => undefined);
      return () => { active = false; };
    }

    watcherIdRef.current = null;
    setWatcherStatus(undefined);
    pendingAutoRefreshPathsRef.current.clear();
    setAutoRefreshError(undefined);
    void invoke<WorkingCopyWatcherStatus>("start_working_copy_watcher", {
      directories: current.scopeDirectories,
      wcRoot: current.wcRoot,
    }).then((status) => {
      if (!active || scopeSetKey(status.directories) !== activeScopeKey) return;
      watcherIdRef.current = status.watcherId;
      setWatcherStatus(status);
    }).catch((error) => {
      if (active) setAutoRefreshError(errorMessage(error));
    });
    return () => { active = false; };
  }, [activeScopeKey, scan?.wcRoot, svnUpdate.running]);

  useEffect(() => () => {
    void invoke("stop_working_copy_watcher").catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    let unlistenUpdate: (() => void) | undefined;

    const handleFinished = (finished: SvnUpdateFinished) => {
      finishedUpdateIdsRef.current.add(finished.updateId);
      setSvnUpdate((current) => current.updateId === finished.updateId
        ? idleSvnUpdateStatus()
        : current);
      setSvnUpdateLaunching(false);

      void (async () => {
        let refreshMessage = "";
        if (scopeSetKey(finished.directories) === activeScanDirectoryRef.current) {
          const result = await scanDirectory(finished.directories, true);
          if (!active) return;
          refreshMessage = result
            ? ` 已重新扫描：${result.changes.length} 项变更。`
            : " 自动重新扫描失败，请查看界面错误后手动刷新。";
        }
        if (active) setToast(`${finished.message}${refreshMessage}`);
      })();
    };

    const setup = async () => {
      try {
        const stopListening = await listen<SvnUpdateFinished>(
          "svn-update-finished",
          (event) => handleFinished(event.payload),
        );
        if (!active) {
          stopListening();
          return;
        }
        unlistenUpdate = stopListening;
        const current = await invoke<SvnUpdateStatus>("get_svn_update_status");
        if (
          active
          && (current.updateId === null || !finishedUpdateIdsRef.current.has(current.updateId))
        ) {
          setSvnUpdate(current);
        }
      } catch (error) {
        if (active) setToast(`无法初始化 SVN Update 状态：${errorMessage(error)}`);
      }
    };

    void setup();
    return () => {
      active = false;
      unlistenUpdate?.();
    };
  }, [scanDirectory]);

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
  }, [
    requestFileReload,
    selected?.baseRevision,
    selected?.isDirectory,
    selected?.item,
    selected?.path,
    storeDiffCache,
  ]);

  useEffect(() => {
    if (!selected || selected.isDirectory || !diff || svnUpdate.running) return;
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
  }, [diff, requestFileReload, selected, svnUpdate.running]);

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
    if (svnUpdate.running) {
      setToast("SVN Update 进行中，结束后会自动重新扫描变更");
      return;
    }
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
  }, [eligibleTextChanges, requestFileReload, storeDiffCache, svnUpdate.running]);

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

  const startSvnUpdate = useCallback(async () => {
    if (!scan || scanLoading || svnUpdate.running || svnUpdateLaunching) return;
    setSvnUpdateLaunching(true);
    setToast(undefined);
    bulkDiffRunRef.current += 1;
    bulkDiffRunningRef.current = false;
    setBulkDiffProgress(undefined);
    pendingFileUpdateRef.current = undefined;
    setPendingFileUpdate(undefined);
    watchBaselineRef.current = undefined;
    try {
      const status = await invoke<SvnUpdateStatus>("start_svn_update", {
        directories: scan.scopeDirectories,
        wcRoot: scan.wcRoot,
      });
      const finishedBeforeResponse = status.updateId !== null
        && finishedUpdateIdsRef.current.has(status.updateId);
      if (!finishedBeforeResponse) {
        setSvnUpdate(status);
        setToast(`已在独立控制台启动 SVN Update：${scan.scopeDirectories.length} 个扫描范围`);
      }
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setSvnUpdateLaunching(false);
    }
  }, [scan, scanLoading, svnUpdate.running, svnUpdateLaunching]);

  const cancelSvnUpdate = useCallback(async () => {
    if (!svnUpdate.running || svnUpdate.updateId === null || svnUpdate.cancelRequested) return;
    try {
      const status = await invoke<SvnUpdateStatus>("cancel_svn_update", {
        updateId: svnUpdate.updateId,
      });
      if (!finishedUpdateIdsRef.current.has(svnUpdate.updateId)) {
        setSvnUpdate(status);
        setToast("正在取消 SVN Update，请等待控制台进程安全退出…");
      }
    } catch (error) {
      setToast(errorMessage(error));
    }
  }, [svnUpdate.cancelRequested, svnUpdate.running, svnUpdate.updateId]);

  const chooseDirectory = useCallback(async () => {
    if (svnUpdate.running || svnUpdateLaunching) {
      setToast("请先完成或取消当前 SVN Update，再切换目录");
      return;
    }
    const selectedDirectory = await open({
      directory: true,
      multiple: true,
      title: "选择一个或多个 SVN 工作副本目录",
    });
    const directories = typeof selectedDirectory === "string"
      ? [selectedDirectory]
      : selectedDirectory;
    if (directories?.length) {
      await scanDirectory(directories);
    }
  }, [scanDirectory, svnUpdate.running, svnUpdateLaunching]);

  const addScanDirectory = useCallback(async () => {
    if (!scan || scanLoading || svnUpdate.running || svnUpdateLaunching) return;
    const selectedDirectory = await open({
      directory: true,
      multiple: false,
      title: "添加一个扫描目录",
    });
    if (typeof selectedDirectory !== "string") return;
    const result = await scanDirectory([...scan.scopeDirectories, selectedDirectory], true);
    if (result) setToast(`扫描范围已更新：${result.scopeDirectories.length} 个目录`);
  }, [scan, scanDirectory, scanLoading, svnUpdate.running, svnUpdateLaunching]);

  const removeScanDirectory = useCallback(async (directory: string) => {
    if (!scan || scan.scopeDirectories.length <= 1 || scanLoading || svnUpdate.running) return;
    const remaining = scan.scopeDirectories.filter(
      (scope) => normalizedPath(scope) !== normalizedPath(directory),
    );
    const result = await scanDirectory(remaining, true);
    if (result) setToast(`已移除扫描范围：${folderName(directory)}`);
  }, [scan, scanDirectory, scanLoading, svnUpdate.running]);

  const openScopeContextMenu = useCallback((
    directory: string,
    x: number,
    y: number,
    returnFocus?: HTMLElement,
  ) => {
    const current = scanRef.current;
    if (!current) return;
    setScopeContextMenu({
      change: scopeDirectoryChange(directory, current),
      x,
      y,
      returnFocus,
    });
  }, []);

  const closeScopeContextMenu = useCallback((restoreFocus = false) => {
    setScopeContextMenu((current) => {
      if (restoreFocus && current?.returnFocus) {
        window.requestAnimationFrame(() => current.returnFocus?.focus());
      }
      return undefined;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!scan?.scopeDirectories.length || scanLoading || svnUpdate.running || svnUpdateLaunching) return;
    const result = await scanDirectory(scan.scopeDirectories, true);
    if (result) setToast(`已刷新当前目录：${result.changes.length} 项变更`);
  }, [scan, scanDirectory, scanLoading, svnUpdate.running, svnUpdateLaunching]);

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
    if (svnUpdate.running) {
      setToast("SVN Update 进行中，请结束后再打开提交窗口");
      return;
    }
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
  }, [commitLaunching, scan, svnUpdate.running]);

  const openTortoiseCommit = useCallback(async () => {
    await launchTortoiseCommit(commitChanges.map((change) => change.path));
  }, [commitChanges, launchTortoiseCommit]);

  const handleItemAction = useCallback(async (action: ChangeItemAction, change: ChangeEntry) => {
    if (!scan) return;
    if (action === "removeScope") {
      await removeScanDirectory(change.path);
      return;
    }
    if (action === "refresh") {
      if (scanLoading || partialScanLoading || svnUpdate.running) {
        setToast("当前已有扫描或 SVN Update 正在运行，请稍后再刷新此项");
        return;
      }
      await refreshChangedPaths(change.refreshPaths?.length ? change.refreshPaths : [change.path], true);
      return;
    }
    if (
      svnUpdate.running
      && ["commit", "revert", "blame", "showLog", "conflictEditor", "resolve"].includes(action)
    ) {
      setToast("SVN Update 进行中，请完成或取消后再执行此操作");
      return;
    }
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
  }, [
    launchTortoiseCommit,
    partialScanLoading,
    refreshChangedPaths,
    removeScanDirectory,
    scan,
    scanLoading,
    svnUpdate.running,
  ]);

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

  const rootIsScope = scan?.scopeDirectories.length === 1
    && normalizedPath(scan.scopeDirectories[0]) === normalizedPath(scan.wcRoot);
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
        <div className="project-title" title={scan?.scopeDirectories.join("\n")}>
          {scan && <span className={`project-dot ${svnUpdate.running ? "updating" : ""}`} />}
          <strong>{scan && scan.scopeDirectories.length > 1
            ? `${scan.scopeDirectories.length} 个扫描目录`
            : folderName(scan?.directory)}</strong>
          {scan && (
            <span className={`change-total ${svnUpdate.running ? "updating" : ""}`}>
              {svnUpdate.running ? "正在 Update" : `${scan.changes.length} 项变更`}
            </span>
          )}
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="toolbar-button"
            onClick={() => void chooseDirectory()}
            disabled={svnUpdate.running || svnUpdateLaunching}
            title={svnUpdate.running ? "请先完成或取消 SVN Update" : "打开目录 (Ctrl+O)"}
          >
            <Icon name="open" size={16} />
            打开目录
          </button>
          <button
            type="button"
            className="toolbar-button refresh-toolbar-button"
            onClick={() => void refresh()}
            disabled={!scan || scanLoading || svnUpdate.running || svnUpdateLaunching}
            title={svnUpdate.running
              ? "SVN Update 结束后会自动刷新"
              : "重新扫描当前打开目录的本地变更 (Ctrl+R)"}
          >
            <Icon name="refresh" size={17} className={scanLoading ? "rotating" : ""} />
            {scanLoading ? "正在刷新…" : "刷新变更"}
          </button>
          <button
            type="button"
            className={`toolbar-button svn-update-toolbar-button ${svnUpdate.running ? "running" : ""}`}
            disabled={svnUpdate.running
              ? svnUpdate.cancelRequested
              : !scan || scanLoading || svnUpdateLaunching}
            title={svnUpdate.running
              ? svnUpdate.cancelRequested
                ? "正在等待 SVN Update 退出"
                : "取消当前 SVN Update"
              : "在独立可见控制台中 Update 当前目录"}
            onClick={() => void (svnUpdate.running ? cancelSvnUpdate() : startSvnUpdate())}
          >
            {svnUpdate.running ? (
              svnUpdate.cancelRequested
                ? <span className="spinner update-spinner" />
                : <Icon name="close" size={15} />
            ) : (
              <Icon name="update" size={16} />
            )}
            {svnUpdateLaunching
              ? "正在启动…"
              : svnUpdate.running
                ? svnUpdate.cancelRequested
                  ? "正在取消…"
                  : "取消 Update"
                : "SVN Update"}
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
                <span>{rootIsScope ? "工作副本" : "扫描范围"}</span>
                <b>{scan.scopeDirectories.length}</b>
              </div>
              <div className="scope-directory-list">
                {scan.scopeDirectories.map((directory) => (
                  <div
                    className={`scope-directory-item ${normalizedPath(scopeContextMenu?.change.path ?? "") === normalizedPath(directory) ? "context-open" : ""}`}
                    key={normalizedPath(directory)}
                    tabIndex={0}
                    role="group"
                    aria-label={`${folderName(directory)} 扫描目录；右键打开目录菜单`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      openScopeContextMenu(
                        directory,
                        event.clientX || bounds.left + 24,
                        event.clientY || bounds.bottom,
                        event.currentTarget,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      openScopeContextMenu(
                        directory,
                        bounds.left + 28,
                        bounds.bottom - 4,
                        event.currentTarget,
                      );
                    }}
                  >
                    <Icon name="folder" size={13} />
                    <span>
                      <strong title={directory}>{folderName(directory)}</strong>
                      <small title={directory}>{directory}</small>
                    </span>
                    {scan.scopeDirectories.length > 1 && (
                      <button
                        type="button"
                        disabled={scanLoading || svnUpdate.running}
                        aria-label={`移除扫描目录 ${folderName(directory)}`}
                        title="移除此扫描范围"
                        onClick={() => void removeScanDirectory(directory)}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="scope-actions">
                <span
                  className={`scope-watch-status ${autoRefreshError ? "error" : autoRefreshBusy ? "busy" : ""}`}
                  title={autoRefreshError
                    ?? (watcherStatus?.watcherId
                      ? "文件保存后自动局部刷新 SVN 状态"
                      : "正在启动文件变更监听")}
                >
                  <i />
                  {autoRefreshError
                    ? "自动刷新异常"
                    : autoRefreshBusy || partialScanLoading
                      ? "局部刷新中"
                      : watcherStatus?.watcherId
                        ? "自动刷新"
                        : "启动监听…"}
                </span>
                <button
                  type="button"
                  disabled={scanLoading || svnUpdate.running || svnUpdateLaunching}
                  onClick={() => void addScanDirectory()}
                >
                  <Icon name="open" size={12} />
                  添加目录
                </button>
              </div>
            </div>

            <ChangesPanel
              directory={scan.directory}
              scopeDirectories={scan.scopeDirectories}
              changes={scan.changes}
              selectedPath={selected?.path}
              selectedCommitPaths={commitSelection}
              tortoiseSvn={tortoiseSvn}
              commitLaunching={commitLaunching}
              workspaceUpdating={svnUpdate.running}
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
        {svnUpdate.running && (
          <span className="svn-update-status" title={svnUpdate.directories.join("\n") || undefined}>
            <span className="spinner" />
            {svnUpdate.cancelRequested
              ? "正在取消 SVN Update"
              : `SVN Update 运行中${svnUpdate.pid ? ` · PID ${svnUpdate.pid}` : ""}`}
          </span>
        )}
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

      {scopeContextMenu && scan && (
        <ChangeContextMenu
          change={scopeContextMenu.change}
          x={scopeContextMenu.x}
          y={scopeContextMenu.y}
          tortoiseAvailable={tortoiseSvn?.available ?? false}
          workspaceUpdating={svnUpdate.running}
          scopeDirectory
          canRemoveScope={scan.scopeDirectories.length > 1
            && !scanLoading
            && !svnUpdate.running
            && !svnUpdateLaunching}
          onAction={(action, change) => void handleItemAction(action, change)}
          onClose={closeScopeContextMenu}
        />
      )}

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
