use crate::models::ScanResult;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const HISTORY_LIMIT: usize = 12;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanHistory {
    scopes: Vec<String>,
    pub saved_at: u64,
    pub scan: ScanResult,
}

fn scope_keys(directories: &[String]) -> Vec<String> {
    let mut keys: Vec<_> = directories
        .iter()
        .map(|path| {
            path.replace('/', "\\")
                .trim_end_matches('\\')
                .to_lowercase()
        })
        .collect();
    keys.sort();
    keys.dedup();
    let all_keys = keys.clone();
    keys.retain(|key| {
        !all_keys
            .iter()
            .any(|parent| key.starts_with(&format!("{parent}\\")))
    });
    keys
}

fn cache_path(directory: &Path, scopes: &[String]) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    scopes.hash(&mut hasher);
    directory.join(format!("scan-v1-{:016x}.json", hasher.finish()))
}

// 只读取本机上次成功扫描的列表，不遍历工作副本
pub fn read(directory: &Path, scopes: &[String]) -> Option<ScanHistory> {
    let keys = scope_keys(scopes);
    let bytes = fs::read(cache_path(directory, &keys)).ok()?;
    let history: ScanHistory = serde_json::from_slice(&bytes).ok()?;
    (history.scopes == keys).then_some(history)
}

// 成功扫描后原子替换历史列表，最多保留最近 12 组目录
pub fn write(directory: &Path, scopes: &[String], scan: &ScanResult) -> Result<(), String> {
    let _lock = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let keys = scope_keys(scopes);
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    let history = ScanHistory {
        scopes: keys.clone(),
        saved_at,
        scan: scan.clone(),
    };
    let destination = cache_path(directory, &keys);
    let pending = destination.with_extension(format!("{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(&history).map_err(|error| error.to_string())?;
    fs::write(&pending, bytes).map_err(|error| error.to_string())?;
    fs::rename(&pending, &destination).map_err(|error| error.to_string())?;

    let mut entries: Vec<_> = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("scan-v1-") && name.ends_with(".json") && entry.path() != destination
        })
        .collect();
    entries.sort_by_key(|entry| {
        std::cmp::Reverse(
            entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok(),
        )
    });
    for entry in entries.into_iter().skip(HISTORY_LIMIT - 1) {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ChangeEntry;

    fn sample() -> ScanResult {
        ScanResult {
            directory: "C:\\WC".into(),
            scope_directories: vec!["C:\\WC".into()],
            wc_root: "C:\\WC".into(),
            revision: Some("12".into()),
            svn_version: "1.14".into(),
            changes: vec![ChangeEntry {
                path: "C:\\WC\\file.cs".into(),
                relative_path: "file.cs".into(),
                name: "file.cs".into(),
                item: "modified".into(),
                properties: "none".into(),
                status_code: "M".into(),
                is_directory: false,
                tree_conflicted: false,
                base_revision: Some("12".into()),
            }],
        }
    }

    #[test]
    fn restores_across_reads_and_windows_path_spellings() {
        let directory = tempfile::tempdir().unwrap();
        let scan = sample();
        write(
            directory.path(),
            &["C:/WC/".into(), "C:/WC/src".into()],
            &scan,
        )
        .unwrap();
        let restored = read(directory.path(), &["c:\\wc".into()]).unwrap();
        assert_eq!(restored.scan.changes[0].path, scan.changes[0].path);
        assert_eq!(restored.scan.revision, Some("12".into()));
        assert!(restored.saved_at > 0);
        assert!(read(directory.path(), &["C:/WC2".into()]).is_none());
        let mut latest = scan;
        latest.changes.clear();
        write(directory.path(), &["C:/WC".into()], &latest).unwrap();
        assert!(read(directory.path(), &["C:/WC".into()])
            .unwrap()
            .scan
            .changes
            .is_empty());
    }

    #[test]
    fn restores_large_history_without_scanning_the_source() {
        let directory = tempfile::tempdir().unwrap();
        let mut scan = sample();
        let entry = scan.changes[0].clone();
        scan.changes = (0..10_000)
            .map(|index| {
                let mut change = entry.clone();
                change.relative_path = format!("src/file{index}.cs");
                change.path = format!("C:/missing-project/src/file{index}.cs");
                change
            })
            .collect();
        let scopes = vec!["C:/missing-project".into()];
        write(directory.path(), &scopes, &scan).unwrap();
        let started = std::time::Instant::now();
        let restored = read(directory.path(), &scopes).unwrap();
        eprintln!("恢复 10000 项历史记录耗时：{:?}", started.elapsed());
        assert_eq!(restored.scan.changes.len(), 10_000);
    }

    #[test]
    fn ignores_corrupt_or_mismatched_snapshots() {
        let directory = tempfile::tempdir().unwrap();
        let scopes = vec!["C:/WC".into()];
        assert!(read(directory.path(), &scopes).is_none());
        let path = cache_path(directory.path(), &scope_keys(&scopes));
        fs::write(&path, b"interrupted JSON").unwrap();
        assert!(read(directory.path(), &scopes).is_none());
        write(directory.path(), &scopes, &sample()).unwrap();
        let other = cache_path(directory.path(), &scope_keys(&["D:/other".into()]));
        fs::copy(path, other).unwrap();
        assert!(read(directory.path(), &["D:/other".into()]).is_none());
    }

    #[test]
    fn bounds_disk_history_without_deleting_other_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("keep.txt"), b"keep").unwrap();
        for index in 0..15 {
            write(directory.path(), &[format!("C:/project{index}")], &sample()).unwrap();
        }
        assert!(read(directory.path(), &["C:/project14".into()]).is_some());
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            HISTORY_LIMIT + 1
        );
        assert!(directory.path().join("keep.txt").exists());
    }
}
