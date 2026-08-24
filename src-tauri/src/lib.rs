mod beyond_compare;
mod models;
mod svn;

use models::{DiffResult, ScanResult};
use std::path::PathBuf;

struct LaunchDirectory(Option<String>);

#[tauri::command]
fn get_launch_directory(state: tauri::State<'_, LaunchDirectory>) -> Option<String> {
    state.0.clone()
}

#[tauri::command]
async fn scan_changes(directory: String) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let beyond_compare = beyond_compare::availability();
        svn::scan(&directory, beyond_compare)
    })
    .await
    .map_err(|error| format!("扫描任务异常结束：{error}"))?
}

#[tauri::command]
async fn get_file_diff(
    path: String,
    item: String,
    properties: String,
) -> Result<DiffResult, String> {
    tauri::async_runtime::spawn_blocking(move || svn::file_diff(&path, &item, &properties))
        .await
        .map_err(|error| format!("diff 任务异常结束：{error}"))?
}

#[tauri::command]
async fn open_in_beyond_compare(path: String, item: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || beyond_compare::open(&path, &item))
        .await
        .map_err(|error| format!("Beyond Compare 启动任务异常结束：{error}"))?
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
        .invoke_handler(tauri::generate_handler![
            get_launch_directory,
            scan_changes,
            get_file_diff,
            open_in_beyond_compare
        ])
        .run(tauri::generate_context!())
        .expect("error while running SVN Scope");
}
