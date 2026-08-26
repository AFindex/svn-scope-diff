mod beyond_compare;
mod models;
mod path_scope;
mod svn;
mod system_shell;
mod tortoise_svn;

use models::{
    CommitLaunchResult, DiffResult, FileFingerprint, ScanResult, ToolAvailability,
    TortoiseSvnAvailability,
};
use std::path::PathBuf;

struct LaunchDirectory(Option<String>);

#[tauri::command]
fn get_launch_directory(state: tauri::State<'_, LaunchDirectory>) -> Option<String> {
    state.0.clone()
}

#[tauri::command]
async fn scan_changes(directory: String) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || svn::scan(&directory))
        .await
        .map_err(|error| format!("扫描任务异常结束：{error}"))?
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
    paths: Vec<String>,
    directory: String,
    wc_root: String,
) -> Result<CommitLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tortoise_svn::open_commit(paths, &directory, &wc_root)
    })
    .await
    .map_err(|error| format!("TortoiseSVN 启动任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_tortoise_svn_action(
    action: String,
    path: String,
    directory: String,
    wc_root: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tortoise_svn::open_action(&action, &path, &directory, &wc_root)
    })
    .await
    .map_err(|error| format!("TortoiseSVN 启动任务异常结束：{error}"))?
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
        .manage(LaunchDirectory(launch_directory()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_launch_directory,
            scan_changes,
            get_beyond_compare_availability,
            get_tortoise_svn_availability,
            get_file_diff,
            get_file_fingerprint,
            get_property_diff,
            open_in_beyond_compare,
            open_tortoise_svn_commit,
            open_tortoise_svn_action,
            open_change_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running SVN Scope");
}
