use crate::models::ToolAvailability;
use crate::svn::svn_base_bytes;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static AVAILABILITY: OnceLock<ToolAvailability> = OnceLock::new();

pub fn availability() -> ToolAvailability {
    AVAILABILITY
        .get_or_init(|| {
            let path = locate();
            ToolAvailability {
                available: path.is_some(),
                path: path.map(|value| value.to_string_lossy().into_owned()),
            }
        })
        .clone()
}

pub fn open(path: &str, item: &str) -> Result<String, String> {
    let executable = availability().path.map(PathBuf::from).ok_or_else(|| {
        "未找到 Beyond Compare 4/5。内嵌 diff 不受影响；安装后重启应用即可启用。".to_owned()
    })?;
    let target = PathBuf::from(path);
    if target.is_dir() {
        return Err("Beyond Compare 外部入口目前用于文件变更；请选择一个文件。".to_owned());
    }

    let cache = compare_cache_directory()?;
    cleanup_old_snapshots(&cache);
    let file_name = safe_file_name(&target);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let prefix = format!("{}-{}", std::process::id(), stamp);
    let base_path = cache.join(format!("{prefix}-BASE-{file_name}"));
    let working_snapshot = cache.join(format!("{prefix}-WORKING-{file_name}"));

    let base = if matches!(item, "added" | "unversioned") {
        Vec::new()
    } else {
        svn_base_bytes(&target).unwrap_or_default()
    };
    fs::write(&base_path, base).map_err(|error| format!("无法创建 BASE 临时快照：{error}"))?;

    let right_path = if target.is_file() && !matches!(item, "deleted" | "missing") {
        target.clone()
    } else {
        fs::write(&working_snapshot, [])
            .map_err(|error| format!("无法创建工作副本临时快照：{error}"))?;
        working_snapshot
    };

    let mut command = Command::new(&executable);
    command
        .arg("/solo")
        .arg("/leftreadonly")
        .arg("/title1=BASE (SVN pristine)")
        .arg("/title2=Working copy")
        .arg(&base_path)
        .arg(&right_path);
    configure_no_window(&mut command);
    command
        .spawn()
        .map_err(|error| format!("无法启动 {}：{error}", executable.display()))?;

    Ok("已在 Beyond Compare 中打开；左侧 BASE 已设为只读。".to_owned())
}

fn locate() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = std::env::var_os("SVN_SCOPE_BCOMPARE_EXE") {
        candidates.push(PathBuf::from(value));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("BCompare.exe"));
            candidates.push(parent.join("tools").join("BCompare.exe"));
        }
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root);
            for version in ["Beyond Compare 5", "Beyond Compare 4"] {
                candidates.push(root.join(version).join("BCompare.exe"));
                candidates.push(root.join(version).join("BComp.exe"));
            }
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        for version in ["Beyond Compare 5", "Beyond Compare 4"] {
            candidates.push(local.join("Programs").join(version).join("BCompare.exe"));
        }
    }

    if let Some(found) = candidates.into_iter().find(|candidate| candidate.is_file()) {
        return Some(found);
    }

    find_on_path(if cfg!(windows) {
        "BCompare.exe"
    } else {
        "bcompare"
    })
    .or_else(|| find_on_path("BComp.exe"))
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

fn compare_cache_directory() -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("SVN Scope").join("compare-cache");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建比较缓存目录 {}：{error}", directory.display()))?;
    Ok(directory)
}

fn cleanup_old_snapshots(directory: &Path) {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(7 * 24 * 60 * 60))
        .unwrap_or(UNIX_EPOCH);
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_old_file = entry
            .metadata()
            .ok()
            .filter(|metadata| metadata.is_file())
            .and_then(|metadata| metadata.modified().ok())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if is_old_file {
            let _ = fs::remove_file(path);
        }
    }
}

fn safe_file_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .unwrap_or_else(|| OsStr::new("file.txt"))
        .to_string_lossy();
    let safe: String = raw
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            other => other,
        })
        .collect();
    if safe.trim().is_empty() {
        "file.txt".to_owned()
    } else {
        safe
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
    fn sanitizes_windows_file_names_without_losing_extension() {
        assert_eq!(safe_file_name(Path::new("bad:name?.tsx")), "bad_name_.tsx");
    }
}
