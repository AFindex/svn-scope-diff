use crate::models::{CommitLaunchResult, TortoiseSvnAvailability};
use crate::path_scope::{path_key, validate_scope, validate_target};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_COMMIT_TARGETS: usize = 20_000;
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn availability() -> TortoiseSvnAvailability {
    let path = locate();
    TortoiseSvnAvailability {
        available: path.is_some(),
        path: path.map(|value| value.to_string_lossy().into_owned()),
        auto_select_files: registry_dword(r"HKCU\Software\TortoiseSVN", "SelectFilesForCommit")
            .unwrap_or(1)
            != 0,
        show_unversioned: registry_dword(r"HKCU\Software\TortoiseSVN", "AddBeforeCommit")
            .unwrap_or(1)
            != 0,
    }
}

pub fn open_commit(
    paths: Vec<String>,
    directory: &str,
    wc_root: &str,
) -> Result<CommitLaunchResult, String> {
    if paths.is_empty() {
        return Err("请先在左侧勾选要提交的修改。".to_owned());
    }
    if paths.len() > MAX_COMMIT_TARGETS {
        return Err(format!(
            "一次最多转交 {MAX_COMMIT_TARGETS} 个目标；当前选择了 {} 个。",
            paths.len()
        ));
    }

    let (scope, working_copy_root) = validate_scope(directory, wc_root)?;

    let mut seen = HashSet::new();
    let mut targets = Vec::with_capacity(paths.len());
    for raw_path in paths {
        let target = validate_target(&raw_path, &scope, &working_copy_root, "提交目标")?;
        if seen.insert(path_key(&target)) {
            targets.push(target);
        }
    }
    if targets.is_empty() {
        return Err("没有可转交给 TortoiseSVN 的有效路径。".to_owned());
    }

    let detected = availability();
    let executable = detected.path.clone().map(PathBuf::from).ok_or_else(|| {
        "未找到 TortoiseProc.exe。请安装 TortoiseSVN，或设置 SVN_SCOPE_TORTOISEPROC_EXE 后重启应用。"
            .to_owned()
    })?;

    let request_directory = request_directory()?;
    cleanup_old_requests(&request_directory);
    let request_path = request_directory.join(request_file_name());
    let encoded = encode_path_file(&targets);
    fs::write(&request_path, encoded)
        .map_err(|error| format!("无法创建 TortoiseSVN 提交路径文件：{error}"))?;

    let mut command = Command::new(&executable);
    command.arg("/command:commit");
    append_pathfile_argument(&mut command, &request_path);
    command.arg("/deletepathfile");

    if let Err(error) = command.spawn() {
        let _ = fs::remove_file(&request_path);
        return Err(format!("无法启动 {}：{error}", executable.display()));
    }

    let message = if detected.auto_select_files {
        format!(
            "已将 {} 项修改交给 TortoiseSVN；提交前请在小乌龟窗口中做最终确认。",
            targets.len()
        )
    } else {
        format!(
            "已打开 TortoiseSVN，但它已关闭“自动选择提交项”；{} 项修改可能不会自动勾选。",
            targets.len()
        )
    };

    Ok(CommitLaunchResult {
        selected_count: targets.len(),
        message,
    })
}

struct ActionSpec {
    command: &'static str,
    opened_label: &'static str,
}

fn action_spec(action: &str) -> Option<ActionSpec> {
    let (command, opened_label) = match action {
        "revert" => ("revert", "Revert 确认窗口"),
        "blame" => ("blame", "Blame 窗口"),
        "showLog" => ("log", "日志窗口"),
        "conflictEditor" => ("conflicteditor", "冲突编辑器"),
        "resolve" => ("resolve", "标记为已解决确认窗口"),
        _ => return None,
    };
    Some(ActionSpec {
        command,
        opened_label,
    })
}

pub fn open_action(
    action: &str,
    path: &str,
    directory: &str,
    wc_root: &str,
) -> Result<String, String> {
    let spec = action_spec(action).ok_or_else(|| format!("不支持的 TortoiseSVN 操作：{action}"))?;
    let (scope, working_copy_root) = validate_scope(directory, wc_root)?;
    let target = validate_target(path, &scope, &working_copy_root, "操作目标")?;
    let executable = locate().ok_or_else(|| {
        "未找到 TortoiseProc.exe。请安装 TortoiseSVN，或设置 SVN_SCOPE_TORTOISEPROC_EXE 后重启应用。"
            .to_owned()
    })?;

    let mut command = Command::new(&executable);
    command.arg(format!("/command:{}", spec.command));
    append_path_argument(&mut command, &target);
    command
        .spawn()
        .map_err(|error| format!("无法启动 {}：{error}", executable.display()))?;

    Ok(format!(
        "已为 {} 打开 TortoiseSVN {}。",
        target.display(),
        spec.opened_label
    ))
}

fn locate() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = std::env::var_os("SVN_SCOPE_TORTOISEPROC_EXE") {
        candidates.push(PathBuf::from(value));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("TortoiseProc.exe"));
            candidates.push(parent.join("tools").join("TortoiseProc.exe"));
        }
    }
    for key in [
        r"HKLM\SOFTWARE\TortoiseSVN",
        r"HKLM\SOFTWARE\WOW6432Node\TortoiseSVN",
    ] {
        if let Some(value) = registry_value(key, "ProcPath") {
            candidates.push(PathBuf::from(value));
        }
        if let Some(value) = registry_value(key, "Directory") {
            candidates.push(PathBuf::from(value).join("bin").join("TortoiseProc.exe"));
        }
    }
    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            candidates.push(
                PathBuf::from(root)
                    .join("TortoiseSVN")
                    .join("bin")
                    .join("TortoiseProc.exe"),
            );
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .or_else(|| find_on_path("TortoiseProc.exe"))
}

fn registry_value(key: &str, name: &str) -> Option<String> {
    let mut command = Command::new("reg.exe");
    command.args(["query", key, "/v", name]);
    configure_no_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_registry_value(&String::from_utf8_lossy(&output.stdout), name)
}

fn registry_dword(key: &str, name: &str) -> Option<u32> {
    let raw = registry_value(key, name)?;
    let trimmed = raw.trim();
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u32::from_str_radix(hex, 16).ok()
    } else {
        trimmed.parse().ok()
    }
}

fn parse_registry_value(output: &str, name: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.len() <= name.len()
            || !trimmed[..name.len()].eq_ignore_ascii_case(name)
            || !trimmed[name.len()..]
                .chars()
                .next()
                .is_some_and(char::is_whitespace)
        {
            continue;
        }
        let remainder = trimmed[name.len()..].trim_start();
        let type_end = remainder.find(char::is_whitespace)?;
        let value = remainder[type_end..].trim();
        if !value.is_empty() {
            return Some(value.trim_matches('"').to_owned());
        }
    }
    None
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let locator = if cfg!(windows) { "where.exe" } else { "which" };
    let mut command = Command::new(locator);
    command.arg(name);
    configure_no_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
}

fn request_directory() -> Result<PathBuf, String> {
    let directory = std::env::temp_dir()
        .join("SVNScope")
        .join("commit-requests");
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "无法创建 TortoiseSVN 临时目录 {}：{error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

fn pathfile_argument(path: &Path) -> String {
    format!(r#"/pathfile:"{}""#, path.to_string_lossy())
}

fn path_argument(path: &Path) -> String {
    format!(r#"/path:"{}""#, path.to_string_lossy())
}

fn append_pathfile_argument(command: &mut Command, path: &Path) {
    #[cfg(windows)]
    command.raw_arg(pathfile_argument(path));

    #[cfg(not(windows))]
    command.arg(format!("/pathfile:{}", path.to_string_lossy()));
}

fn append_path_argument(command: &mut Command, path: &Path) {
    #[cfg(windows)]
    command.raw_arg(path_argument(path));

    #[cfg(not(windows))]
    command.arg(format!("/path:{}", path.to_string_lossy()));
}

fn request_file_name() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{stamp}-{counter}.paths", std::process::id())
}

fn encode_path_file(paths: &[PathBuf]) -> Vec<u8> {
    let mut encoded = Vec::new();
    for path in paths {
        // CTSVNPathList reads this in binary mode and its own writer uses LF only.
        // CRLF would leave a trailing '\r' on every target and make SVN status empty.
        for unit in path.to_string_lossy().encode_utf16().chain(['\n' as u16]) {
            encoded.extend_from_slice(&unit.to_le_bytes());
        }
    }
    encoded
}

fn cleanup_old_requests(directory: &Path) {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(7 * 24 * 60 * 60))
        .unwrap_or(UNIX_EPOCH);
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_old_request = path
            .extension()
            .is_some_and(|extension| extension == "paths")
            && entry
                .metadata()
                .ok()
                .filter(|metadata| metadata.is_file())
                .and_then(|metadata| metadata.modified().ok())
                .is_some_and(|modified| modified < cutoff);
        if is_old_request {
            let _ = fs::remove_file(path);
        }
    }
}

fn configure_no_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_string_and_dword_registry_values() {
        let output = r#"
HKEY_LOCAL_MACHINE\SOFTWARE\TortoiseSVN
    ProcPath    REG_SZ    C:\Program Files\TortoiseSVN\bin\TortoiseProc.exe
    SelectFilesForCommit    REG_DWORD    0x1
"#;
        assert_eq!(
            parse_registry_value(output, "ProcPath").as_deref(),
            Some(r"C:\Program Files\TortoiseSVN\bin\TortoiseProc.exe")
        );
        assert_eq!(
            parse_registry_value(output, "SelectFilesForCommit").as_deref(),
            Some("0x1")
        );
    }

    #[test]
    fn path_file_is_utf16_little_endian_without_bom() {
        let encoded = encode_path_file(&[PathBuf::from(r"F:\工作副本\main.cs")]);
        assert_ne!(&encoded[..2], &[0xff, 0xfe]);
        let units: Vec<u16> = encoded
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        assert_eq!(
            String::from_utf16(&units).unwrap(),
            "F:\\工作副本\\main.cs\n"
        );
    }

    #[test]
    fn pathfile_command_uses_tortoise_value_quoting() {
        assert_eq!(
            pathfile_argument(Path::new(
                r"C:\Users\Test User\AppData\Local\Temp\SVNScope\request.paths"
            )),
            r#"/pathfile:"C:\Users\Test User\AppData\Local\Temp\SVNScope\request.paths""#
        );
    }

    #[test]
    fn direct_path_command_uses_tortoise_value_quoting() {
        assert_eq!(
            path_argument(Path::new(r"C:\working copy\src\main.cs")),
            r#"/path:"C:\working copy\src\main.cs""#
        );
    }

    #[test]
    fn only_explicit_tortoise_actions_are_allowed() {
        assert_eq!(action_spec("revert").unwrap().command, "revert");
        assert_eq!(action_spec("showLog").unwrap().command, "log");
        assert_eq!(
            action_spec("conflictEditor").unwrap().command,
            "conflicteditor"
        );
        assert!(action_spec("update").is_none());
    }
}
