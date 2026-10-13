mod beyond_compare;
mod client_update;
mod models;
mod path_scope;
mod scan_history;
mod svn;
mod svn_update;
mod system_shell;
mod tortoise_svn;
mod watch_path_filter;
mod working_copy_watcher;

use models::{
    CommitLaunchResult, DiffResult, FileFingerprint, ScanPatch, ScanResult, SvnUpdateStatus,
    ToolAvailability, TortoiseSvnAvailability, WorkingCopyWatcherStatus,
};
use std::path::PathBuf;

#[tauri::command]
async fn check_client_update() -> Result<client_update::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(client_update::check)
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
async fn download_client_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        client_update::download(&app.state::<client_update::UpdateManager>(), &version)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
fn install_client_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, client_update::UpdateManager>,
) -> Result<(), String> {
    client_update::install(&state)?;
    app.exit(0);
    Ok(())
}

struct LaunchDirectory(Option<String>);

#[tauri::command]
fn get_launch_directory(state: tauri::State<'_, LaunchDirectory>) -> Option<String> {
    state.0.clone()
}

#[tauri::command]
async fn scan_changes(
    app: tauri::AppHandle,
    directories: Vec<String>,
) -> Result<ScanResult, String> {
    use tauri::Manager;
    let cache_directory = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|path| path.join("scan-history"));
    tauri::async_runtime::spawn_blocking(move || {
        let result = svn::scan_scopes(&directories)?;
        if let Some(directory) = cache_directory {
            // 缓存不可写时仍正常返回扫描结果
            let _ = scan_history::write(&directory, &directories, &result);
        }
        Ok(result)
    })
    .await
    .map_err(|error| format!("扫描任务异常结束：{error}"))?
}

#[tauri::command]
async fn read_scan_history(
    app: tauri::AppHandle,
    directories: Vec<String>,
) -> Option<scan_history::ScanHistory> {
    use tauri::Manager;
    let directory = app.path().app_cache_dir().ok()?.join("scan-history");
    tauri::async_runtime::spawn_blocking(move || scan_history::read(&directory, &directories))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn scan_changed_paths(
    scope_directories: Vec<String>,
    paths: Vec<String>,
    display_root: String,
    wc_root: String,
) -> Result<ScanPatch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        svn::scan_changed_paths(&scope_directories, &paths, &display_root, &wc_root)
    })
    .await
    .map_err(|error| format!("局部扫描任务异常结束：{error}"))?
}

#[tauri::command]
async fn get_beyond_compare_availability() -> Result<ToolAvailability, String> {
    tauri::async_runtime::spawn_blocking(beyond_compare::availability)
        .await
        .map_err(|error| format!("工具检测任务异常结束：{error}"))
}

#[tauri::command]
async fn get_tortoise_svn_availability() -> Result<TortoiseSvnAvailability, String> {
    tauri::async_runtime::spawn_blocking(tortoise_svn::availability)
        .await
        .map_err(|error| format!("工具检测任务异常结束：{error}"))
}

#[tauri::command]
async fn get_file_diff(
    path: String,
    item: String,
    is_directory: bool,
    base_revision: Option<String>,
) -> Result<DiffResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        svn::file_diff(&path, &item, is_directory, base_revision.as_deref())
    })
    .await
    .map_err(|error| format!("diff 任务异常结束：{error}"))?
}

#[tauri::command]
async fn get_file_fingerprint(path: String) -> Result<FileFingerprint, String> {
    tauri::async_runtime::spawn_blocking(move || svn::file_fingerprint(&path))
        .await
        .map_err(|error| format!("文件状态检测任务异常结束：{error}"))?
}

#[tauri::command]
async fn save_working_file_content(
    path: String,
    expected_content: String,
    content: String,
    fallback_encoding: String,
    directory: String,
    scope_directories: Vec<String>,
    wc_root: String,
) -> Result<FileFingerprint, String> {
    tauri::async_runtime::spawn_blocking(move || {
        svn::save_working_file_content(
            &path,
            &expected_content,
            &content,
            &fallback_encoding,
            &directory,
            &scope_directories,
            &wc_root,
        )
    })
    .await
    .map_err(|error| format!("局部还原写入任务异常结束：{error}"))?
}

#[tauri::command]
async fn get_property_diff(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || svn::property_diff(&path))
        .await
        .map_err(|error| format!("属性 diff 任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_in_beyond_compare(path: String, item: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || beyond_compare::open(&path, &item))
        .await
        .map_err(|error| format!("Beyond Compare 启动任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_tortoise_svn_commit(
    app: tauri::AppHandle,
    paths: Vec<String>,
    directory: String,
    wc_root: String,
) -> Result<CommitLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tortoise_svn::open_commit(app, paths, &directory, &wc_root)
    })
    .await
    .map_err(|error| format!("TortoiseSVN 启动任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_tortoise_svn_action(
    app: tauri::AppHandle,
    action: String,
    path: String,
    directory: String,
    wc_root: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tortoise_svn::open_action(app, &action, &path, &directory, &wc_root)
    })
    .await
    .map_err(|error| format!("TortoiseSVN 启动任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_tortoise_svn_batch_action(
    app: tauri::AppHandle,
    action: String,
    paths: Vec<String>,
    directory: String,
    wc_root: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tortoise_svn::open_batch_action(app, &action, paths, &directory, &wc_root)
    })
    .await
    .map_err(|error| format!("TortoiseSVN 批量启动任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_change_path(
    action: String,
    path: String,
    directory: String,
    wc_root: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        system_shell::open_change_path(&action, &path, &directory, &wc_root)
    })
    .await
    .map_err(|error| format!("系统路径操作任务异常结束：{error}"))?
}

#[tauri::command]
fn get_svn_update_status(
    state: tauri::State<'_, svn_update::SvnUpdateManager>,
) -> Result<SvnUpdateStatus, String> {
    svn_update::status(&state)
}

#[tauri::command]
fn start_svn_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, svn_update::SvnUpdateManager>,
    directories: Vec<String>,
    wc_root: String,
) -> Result<SvnUpdateStatus, String> {
    svn_update::start(app, &state, &directories, &wc_root)
}

#[tauri::command]
fn cancel_svn_update(
    state: tauri::State<'_, svn_update::SvnUpdateManager>,
    update_id: u64,
) -> Result<SvnUpdateStatus, String> {
    svn_update::cancel(&state, update_id)
}

#[tauri::command]
fn get_working_copy_watcher_status(
    state: tauri::State<'_, working_copy_watcher::WorkingCopyWatcherManager>,
) -> Result<WorkingCopyWatcherStatus, String> {
    working_copy_watcher::status(&state)
}

#[tauri::command]
fn start_working_copy_watcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, working_copy_watcher::WorkingCopyWatcherManager>,
    directories: Vec<String>,
    wc_root: String,
) -> Result<WorkingCopyWatcherStatus, String> {
    working_copy_watcher::start(app, &state, &directories, &wc_root)
}

#[tauri::command]
fn stop_working_copy_watcher(
    state: tauri::State<'_, working_copy_watcher::WorkingCopyWatcherManager>,
) -> Result<WorkingCopyWatcherStatus, String> {
    working_copy_watcher::stop(&state)
}

fn launch_directory() -> Option<String> {
    let argument = std::env::args_os().nth(1)?;
    let mut path = PathBuf::from(argument);
    if path.is_file() {
        path = path.parent()?.to_path_buf();
    }
    if !path.is_dir() {
        return None;
    }
    std::path::absolute(path)
        .ok()
        .map(|value| value.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(client_update::UpdateManager::default())
        .manage(LaunchDirectory(launch_directory()))
        .manage(svn_update::SvnUpdateManager::default())
        .manage(working_copy_watcher::WorkingCopyWatcherManager::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_client_update,
            download_client_update,
            install_client_update,
            get_launch_directory,
            scan_changes,
            read_scan_history,
            scan_changed_paths,
            get_beyond_compare_availability,
            get_tortoise_svn_availability,
            get_file_diff,
            get_file_fingerprint,
            save_working_file_content,
            get_property_diff,
            open_in_beyond_compare,
            open_tortoise_svn_commit,
            open_tortoise_svn_action,
            open_tortoise_svn_batch_action,
            open_change_path,
            get_svn_update_status,
            start_svn_update,
            cancel_svn_update,
            get_working_copy_watcher_status,
            start_working_copy_watcher,
            stop_working_copy_watcher
        ])
        .run(tauri::generate_context!())
        .expect("error while running SVN Scope");
}
