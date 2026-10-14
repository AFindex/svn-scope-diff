use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Checkpoint {
    pub volume: String,
    pub journal_id: u64,
    pub next_usn: i64,
}

#[cfg(windows)]
#[path = "change_journal_windows.rs"]
mod platform;

// 保存扫描开始前的日志位置，扫描期间的新变化留给下次核对
pub fn checkpoint(path: &Path) -> Result<Checkpoint, String> {
    #[cfg(windows)]
    {
        platform::checkpoint(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前系统不支持 NTFS 变更日志".into())
    }
}

// 返回上次检查点之后的文件路径；记录不完整时要求完整核对
pub fn changed_paths(
    saved: &Checkpoint,
    scopes: &[String],
    wc_root: &str,
) -> Result<(Checkpoint, Vec<String>), String> {
    #[cfg(windows)]
    {
        platform::changed_paths(saved, scopes, wc_root)
    }
    #[cfg(not(windows))]
    {
        let _ = (saved, scopes, wc_root);
        Err("当前系统不支持 NTFS 变更日志".into())
    }
}
