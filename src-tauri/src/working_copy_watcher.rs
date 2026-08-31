use crate::models::{WorkingCopyChanged, WorkingCopyWatchError, WorkingCopyWatcherStatus};
use crate::{path_scope, svn};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const CHANGED_EVENT: &str = "working-copy-changed";
pub const ERROR_EVENT: &str = "working-copy-watch-error";
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

    thread::spawn(move || event_loop(app, watcher_id, minimal_scopes, receiver));
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
    receiver: Receiver<notify::Result<Event>>,
) {
    let mut pending: HashMap<String, PathBuf> = HashMap::new();
    let mut deadline: Option<Instant> = None;

    loop {
        let timeout = deadline
            .map(|value| value.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(3600));
        match receiver.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                for path in event.paths {
                    let path = std::path::absolute(&path).unwrap_or(path);
                    if is_svn_admin_path(&path)
                        || scopes
                            .iter()
                            .any(|scope| path_scope::path_key(&path) == path_scope::path_key(scope))
                        || !scopes
                            .iter()
                            .any(|scope| path_scope::path_is_within(&path, scope))
                    {
                        continue;
                    }
                    pending.insert(path_scope::path_key(&path), path);
                }
                if !pending.is_empty() {
                    deadline = Some(Instant::now() + DEBOUNCE_INTERVAL);
                }
            }
            Ok(Err(error)) => {
                let _ = app.emit(
                    ERROR_EVENT,
                    WorkingCopyWatchError {
                        watcher_id,
                        message: format!("文件变更监听失败：{error}"),
                    },
                );
            }
            Err(RecvTimeoutError::Timeout) => {
                emit_pending(&app, watcher_id, &mut pending);
                deadline = None;
            }
            Err(RecvTimeoutError::Disconnected) => {
                emit_pending(&app, watcher_id, &mut pending);
                break;
            }
        }
    }
}

fn emit_pending(app: &AppHandle, watcher_id: u64, pending: &mut HashMap<String, PathBuf>) {
    if pending.is_empty() {
        return;
    }
    let mut paths: Vec<String> = pending
        .drain()
        .map(|(_, path)| path.to_string_lossy().into_owned())
        .collect();
    paths.sort_by_cached_key(|path| path.to_lowercase());
    let _ = app.emit(CHANGED_EVENT, WorkingCopyChanged { watcher_id, paths });
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
