use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

const MANIFEST_URL: &str =
    "https://github.com/AFindex/svn-scope-diff/releases/latest/download/update.json";
#[derive(Deserialize)]
struct Manifest {
    version: String,
    sha256: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    available: bool,
}
#[derive(Default)]
pub struct UpdateManager {
    staged: Mutex<Option<PathBuf>>,
    busy: Mutex<()>,
}

fn version_parts(version: &str) -> Result<Vec<u64>, String> {
    let parts = version
        .split('.')
        .map(|part| part.parse::<u64>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "更新版本号必须为 major.minor.patch".to_owned())?;
    if parts.len() != 3 {
        return Err("更新版本号必须为 major.minor.patch".to_owned());
    }
    Ok(parts)
}
fn powershell() -> Command {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
    ]);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
}
fn manifest() -> Result<Manifest, String> {
    let script = format!("$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri '{MANIFEST_URL}').Content");
    let output = powershell()
        .args(["-Command", &script])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "无法访问发布源（网络、代理或尚未发布 update.json）：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let manifest: Manifest =
        serde_json::from_slice(&output.stdout).map_err(|error| format!("更新清单无效：{error}"))?;
    version_parts(&manifest.version)?;
    if manifest.sha256.len() != 64 || !manifest.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("更新清单缺少有效 SHA-256".to_owned());
    }
    Ok(manifest)
}
pub fn check() -> Result<UpdateInfo, String> {
    let manifest = manifest()?;
    Ok(UpdateInfo {
        available: version_parts(&manifest.version)? > version_parts(env!("CARGO_PKG_VERSION"))?,
        version: manifest.version,
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
    })
}
pub fn download(manager: &UpdateManager, version: &str) -> Result<(), String> {
    let _busy = manager
        .busy
        .try_lock()
        .map_err(|_| "已有客户端下载任务正在运行".to_owned())?;
    let manifest = manifest()?;
    if manifest.version != version
        || version_parts(version)? <= version_parts(env!("CARGO_PKG_VERSION"))?
    {
        return Err("发布版本已变化，请重新检查更新".to_owned());
    }
    let directory = std::env::temp_dir().join(format!("svn-scope-update-{}", std::process::id()));
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let script = directory.join("download.ps1");
    std::fs::write(&script, include_str!("../scripts/download-update.ps1"))
        .map_err(|error| error.to_string())?;
    let output = powershell()
        .arg("-File")
        .arg(&script)
        .arg("-Version")
        .arg(version)
        .arg("-Sha256")
        .arg(&manifest.sha256)
        .arg("-Directory")
        .arg(&directory)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    *manager.staged.lock().map_err(|error| error.to_string())? = Some(directory);
    Ok(())
}
pub fn install(manager: &UpdateManager) -> Result<(), String> {
    let _busy = manager
        .busy
        .try_lock()
        .map_err(|_| "客户端下载尚未完成".to_owned())?;
    let directory = manager
        .staged
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "请先下载客户端更新".to_owned())?;
    let target = std::env::current_exe().map_err(|error| error.to_string())?;
    let script = directory.join("install.ps1");
    std::fs::write(&script, include_str!("../scripts/install-update.ps1"))
        .map_err(|error| error.to_string())?;
    // Probe write access before closing the client
    let probe = target.with_extension("update-probe");
    let probe_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| format!("客户端目录不可写：{error}"))?;
    drop(probe_file);
    std::fs::remove_file(&probe).map_err(|error| error.to_string())?;
    powershell()
        .arg("-File")
        .arg(script)
        .arg("-Target")
        .arg(target)
        .arg("-Directory")
        .arg(directory)
        .arg("-ParentId")
        .arg(std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动更新程序：{error}"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_numeric_versions_and_rejects_script_characters() {
        assert!(version_parts("0.10.0").unwrap() > version_parts("0.9.9").unwrap());
        for version in ["v1.0.0", "1.0", "1.0.0;exit", "../1.0.0", "1.0.0-beta"] {
            assert!(version_parts(version).is_err());
        }
    }
}
