use crate::models::{WorkingCopyChanged, WorkingCopyWatchError, WorkingCopyWatcherStatus};
use crate::watch_path_filter::WatchPathFilter;
use crate::{path_scope, svn};
use notify::{event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const CHANGED_EVENT: &str = "working-copy-changed";
pub const ERROR_EVENT: &str = "working-copy-watch-error";
const MAX_BATCH_DELAY: Duration = Duration::from_secs(2);
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(450);

#[derive(Clone, Default)]
pub struct WorkingCopyWatcherManager {
    inner: Arc<Mutex<WatcherState>>,
}

#[derive(Default)]
struct WatcherState {
    next_id: u64,
    active: Option<ActiveWatcher>,
}

struct ActiveWatcher {
    watcher_id: u64,
    directories: Vec<String>,
    _watcher: RecommendedWatcher,
}

pub fn status(manager: &WorkingCopyWatcherManager) -> Result<WorkingCopyWatcherStatus, String> {
    let state = manager
        .inner
        .lock()
        .map_err(|_| "自动刷新监听状态锁已损坏。".to_owned())?;
    Ok(status_from_state(&state))
}

pub fn start(
    app: AppHandle,
    manager: &WorkingCopyWatcherManager,
    directories: &[String],
    wc_root: &str,
) -> Result<WorkingCopyWatcherStatus, String> {
    if directories.is_empty() {
        return Err("请至少指定一个自动刷新监听目录。".to_owned());
    }

    let mut scopes = Vec::new();
    for directory in directories {
        let (scope, declared_root) = path_scope::validate_scope(directory, wc_root)?;
        if !scope.is_dir() {
            return Err(format!("自动刷新监听目录不存在：{}", scope.display()));
        }
        let actual_root = svn::working_copy_root(&scope)?;
        if path_scope::path_key(&actual_root) != path_scope::path_key(&declared_root) {
            return Err("监听目录的 SVN 工作副本与扫描结果不一致，请先完整刷新。".to_owned());
        }
        if !scopes.iter().any(|existing: &PathBuf| {
            path_scope::path_key(existing) == path_scope::path_key(&scope)
        }) {
            scopes.push(scope);
        }
    }
    scopes.sort_by_key(|path| path.components().count());
    let mut minimal_scopes: Vec<PathBuf> = Vec::new();
    for scope in scopes {
        if minimal_scopes
            .iter()
            .any(|existing| path_scope::path_is_within(&scope, existing))
        {
            continue;
        }
        minimal_scopes.retain(|existing| !path_scope::path_is_within(existing, &scope));
        minimal_scopes.push(scope);
    }
    minimal_scopes.sort_by_cached_key(|path| path_scope::path_key(path));
    let directory_strings: Vec<String> = minimal_scopes
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();

    {
        let state = manager
            .inner
            .lock()
            .map_err(|_| "自动刷新监听状态锁已损坏。".to_owned())?;
        if state.active.as_ref().is_some_and(|active| {
            scope_set_key(&active.directories) == scope_set_key(&directory_strings)
        }) {
            return Ok(status_from_state(&state));
        }
    }

    let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(sender)
        .map_err(|error| format!("无法创建文件变更监听器：{error}"))?;
    for scope in &minimal_scopes {
        watcher
            .watch(scope, RecursiveMode::Recursive)
            .map_err(|error| format!("无法监听目录 {}：{error}", scope.display()))?;
    }

    // SVN properties, BASE and scheduling changes may only touch wc.db
    let admin_directory = Path::new(wc_root).join(".svn");
    if !minimal_scopes
        .iter()
        .any(|scope| path_scope::path_is_within(&admin_directory, scope))
    {
        watcher
            .watch(&admin_directory, RecursiveMode::NonRecursive)
            .map_err(|error| {
                format!("无法监听 SVN 元数据 {}：{error}", admin_directory.display())
            })?;
    }

    let (watcher_id, previous) = {
        let mut state = manager
            .inner
            .lock()
            .map_err(|_| "自动刷新监听状态锁已损坏。".to_owned())?;
        state.next_id = state.next_id.wrapping_add(1).max(1);
        let watcher_id = state.next_id;
        let previous = state.active.replace(ActiveWatcher {
            watcher_id,
            directories: directory_strings.clone(),
            _watcher: watcher,
        });
        (watcher_id, previous)
    };
    drop(previous);

    let wc_root = PathBuf::from(wc_root);
    thread::spawn(move || event_loop(app, watcher_id, minimal_scopes, wc_root, receiver));
    Ok(WorkingCopyWatcherStatus {
        watcher_id: Some(watcher_id),
        directories: directory_strings,
    })
}

pub fn stop(manager: &WorkingCopyWatcherManager) -> Result<WorkingCopyWatcherStatus, String> {
    let previous = {
        let mut state = manager
            .inner
            .lock()
            .map_err(|_| "自动刷新监听状态锁已损坏。".to_owned())?;
        state.active.take()
    };
    drop(previous);
    Ok(WorkingCopyWatcherStatus {
        watcher_id: None,
        directories: Vec::new(),
    })
}

fn status_from_state(state: &WatcherState) -> WorkingCopyWatcherStatus {
    match &state.active {
        Some(active) => WorkingCopyWatcherStatus {
            watcher_id: Some(active.watcher_id),
            directories: active.directories.clone(),
        },
        None => WorkingCopyWatcherStatus {
            watcher_id: None,
            directories: Vec::new(),
        },
    }
}

fn event_loop(
    app: AppHandle,
    watcher_id: u64,
    scopes: Vec<PathBuf>,
    wc_root: PathBuf,
    receiver: Receiver<notify::Result<Event>>,
) {
    let mut path_filter = WatchPathFilter::default();
    let mut pending: HashMap<String, PathBuf> = HashMap::new();
    let mut rescans: HashMap<String, PathBuf> = HashMap::new();
    let mut deadline: Option<Instant> = None;
    let mut batch_started: Option<Instant> = None;

    loop {
        let timeout = deadline
            .map(|value| value.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(3600));
        match receiver.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                if event.need_rescan()
                    || event.paths.iter().any(|path| {
                        is_svn_admin_path(path)
                            && path
                                .file_name()
                                .is_some_and(|name| name == "wc.db" || name == "wc.db-wal")
                    })
                {
                    path_filter.clear();
                    for scope in &scopes {
                        rescans.insert(path_scope::path_key(scope), scope.clone());
                    }
                }
                path_filter.invalidate_event(&event);
                for path in event.paths {
                    let path = std::path::absolute(&path).unwrap_or(path);
                    if is_svn_admin_path(&path)
                        || !scopes
                            .iter()
                            .any(|scope| path_scope::path_is_within(&path, scope))
                    {
                        continue;
                    }
                    // 子项事件已包含实际路径，目录时间戳变化不应扩大为递归扫描
                    if is_directory_write(event.kind, &path) {
                        continue;
                    }
                    pending.insert(path_scope::path_key(&path), path);
                }
                if !pending.is_empty() || !rescans.is_empty() {
                    let now = Instant::now();
                    let started = *batch_started.get_or_insert(now);
                    deadline = Some(batch_deadline(started, now));
                    if now >= started + MAX_BATCH_DELAY {
                        emit_pending(&app, watcher_id, &mut pending, &mut rescans, &mut path_filter, &wc_root);
                        deadline = None;
                        batch_started = None;
                    }
                }
            }
            Ok(Err(error)) => {
                path_filter.clear();
                for scope in &scopes {
                    rescans.insert(path_scope::path_key(scope), scope.clone());
                }
                deadline = Some(Instant::now() + DEBOUNCE_INTERVAL);
                let _ = app.emit(
                    ERROR_EVENT,
                    WorkingCopyWatchError {
                        watcher_id,
                        message: format!("文件变更监听失败：{error}"),
                    },
                );
            }
            Err(RecvTimeoutError::Timeout) => {
                emit_pending(&app, watcher_id, &mut pending, &mut rescans, &mut path_filter, &wc_root);
                deadline = None;
                batch_started = None;
            }
            Err(RecvTimeoutError::Disconnected) => {
                emit_pending(&app, watcher_id, &mut pending, &mut rescans, &mut path_filter, &wc_root);
                break;
            }
        }
    }
}

fn batch_deadline(started: Instant, now: Instant) -> Instant {
    (now + DEBOUNCE_INTERVAL).min(started + MAX_BATCH_DELAY)
}

fn is_directory_write(kind: EventKind, path: &Path) -> bool {
    matches!(kind, EventKind::Modify(ModifyKind::Any | ModifyKind::Data(_) | ModifyKind::Metadata(_)))
        && path.is_dir()
}

fn emit_pending(
    app: &AppHandle, watcher_id: u64, pending: &mut HashMap<String, PathBuf>,
    rescans: &mut HashMap<String, PathBuf>, filter: &mut WatchPathFilter, wc_root: &Path,
) {
    if pending.is_empty() && rescans.is_empty() {
        return;
    }
    // 先合并重复通知，再检查忽略状态；元数据核对走独立后台队列
    let mut paths: Vec<String> = pending
        .drain()
        .filter(|(_, path)| !filter.is_ignored(path, wc_root).unwrap_or(false))
        .filter_map(|(key, path)| {
            if path.is_dir() {
                rescans.insert(key, path);
                None
            } else {
                Some((key, path))
            }
        })
        .map(|(_, path)| path.to_string_lossy().into_owned())
        .collect();
    paths.sort_by_cached_key(|path| path.to_lowercase());
    let rescan_paths = rescans.drain().map(|(_, path)| path.to_string_lossy().into_owned()).collect();
    let _ = app.emit(CHANGED_EVENT, WorkingCopyChanged { watcher_id, paths, rescan_paths });
}

fn is_svn_admin_path(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(component, Component::Normal(value) if value.to_string_lossy().eq_ignore_ascii_case(".svn"))
    })
}

fn scope_set_key(directories: &[String]) -> String {
    let mut keys: Vec<String> = directories
        .iter()
        .map(|directory| path_scope::path_key(Path::new(directory)))
        .collect();
    keys.sort();
    keys.join("|")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn continuous_writes_cannot_defer_a_batch_forever() {
        let started = Instant::now();
        assert_eq!(
            batch_deadline(started, started),
            started + DEBOUNCE_INTERVAL
        );
        assert_eq!(
            batch_deadline(started, started + Duration::from_millis(1900)),
            started + MAX_BATCH_DELAY
        );
    }

    #[test]
    fn directory_timestamp_notifications_do_not_expand_file_refreshes() {
        use notify::event::{CreateKind, RemoveKind, RenameMode};
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        let file = root.join("source.cs");
        fs::write(&file, "source\r\n").unwrap();
        assert!(is_directory_write(EventKind::Modify(ModifyKind::Any), root));
        assert!(!is_directory_write(EventKind::Modify(ModifyKind::Any), &file));
        for kind in [
            EventKind::Create(CreateKind::Any),
            EventKind::Remove(RemoveKind::Any),
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
        ] {
            assert!(!is_directory_write(kind, root));
        }
    }

    #[test]
    fn ignores_svn_administration_paths_case_insensitively() {
        assert!(is_svn_admin_path(Path::new(r"F:\wc\.svn\wc.db")));
        assert!(is_svn_admin_path(Path::new(r"F:\wc\.SVN\tmp\x")));
        assert!(!is_svn_admin_path(Path::new(r"F:\wc\src\svn.cs")));
    }

    #[test]
    fn scope_keys_ignore_order_and_path_spelling() {
        let left = vec![r"F:\wc\src\".to_owned(), r"F:\wc\tools".to_owned()];
        let right = vec![r"f:/wc/tools".to_owned(), r"f:/wc/src".to_owned()];
        assert_eq!(scope_set_key(&left), scope_set_key(&right));
    }

    #[test]
    fn recommended_watcher_reports_a_new_file_below_the_scope() {
        let temporary = tempfile::tempdir().unwrap();
        let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(sender).unwrap();
        watcher
            .watch(temporary.path(), RecursiveMode::Recursive)
            .unwrap();

        let created = temporary.path().join("created.cs");
        fs::write(&created, "class Created {}\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut observed = false;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let Ok(event) = receiver.recv_timeout(remaining) else {
                break;
            };
            if event
                .unwrap()
                .paths
                .iter()
                .any(|path| path_scope::path_key(path) == path_scope::path_key(&created))
            {
                observed = true;
                break;
            }
        }
        assert!(
            observed,
            "notify did not report the created file within 5 seconds"
        );
    }
}
