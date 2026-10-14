use crate::{
    change_journal, models::ScanResult, path_scope, scan_history, svn,
    watch_path_filter::WatchPathFilter,
};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub scan: ScanResult,
    pub incremental: bool,
    pub reason: String,
}

// 完整扫描从开始前记录检查点，扫描中发生的变更下次仍会重放
pub fn full_scan(cache: Option<&Path>, scopes: &[String]) -> Result<ScanResult, String> {
    let checkpoint = scopes
        .first()
        .and_then(|scope| change_journal::checkpoint(Path::new(scope)).ok());
    let scan = svn::scan_scopes(scopes)?;
    if let Some(cache) = cache {
        let _ = scan_history::write_checkpoint(cache, scopes, &scan, checkpoint);
    }
    Ok(scan)
}

// 恢复历史后只查询日志涉及的路径，无法证明记录完整时执行完整核对
pub fn open(cache: Option<&Path>, scopes: &[String]) -> Result<OpenResult, String> {
    let attempt = cache
        .ok_or("历史缓存目录不可用".to_owned())
        .and_then(|cache| incremental(cache, scopes));
    match attempt {
        Ok(scan) => Ok(OpenResult {
            scan,
            incremental: true,
            reason: "已按文件变更记录完成增量核对".into(),
        }),
        Err(reason) => Ok(OpenResult {
            scan: full_scan(cache, scopes)?,
            incremental: false,
            reason,
        }),
    }
}

fn incremental(cache: &Path, scopes: &[String]) -> Result<ScanResult, String> {
    let history = scan_history::read(cache, scopes).ok_or("首次打开或历史缓存缺失".to_owned())?;
    let checkpoint = history
        .checkpoint
        .ok_or("历史缓存尚未建立增量检查点".to_owned())?;
    if scopes.iter().any(|scope| !Path::new(scope).is_dir()) {
        return Err("历史目录已移动或删除".into());
    }
    let mut scan = history.scan;
    let (next, paths) =
        change_journal::changed_paths(&checkpoint, &scan.scope_directories, &scan.wc_root)?;
    let mut filter = WatchPathFilter::default();
    let paths: Vec<_> = paths
        .into_iter()
        .filter(|path| {
            !filter
                .is_ignored(Path::new(path), Path::new(&scan.wc_root))
                .unwrap_or(false)
        })
        .collect();
    if !paths.is_empty() {
        let patch = svn::scan_changed_paths(
            &scan.scope_directories,
            &paths,
            &scan.directory,
            &scan.wc_root,
        )?;
        scan.changes.retain(|change| {
            !patch
                .roots
                .iter()
                .any(|root| path_scope::path_is_within(Path::new(&change.path), Path::new(root)))
        });
        scan.changes.extend(patch.changes);
        scan.changes
            .sort_by_cached_key(|change| change.relative_path.to_lowercase());
    }
    let _ = scan_history::write_checkpoint(cache, scopes, &scan, Some(next));
    Ok(scan)
}

// 运行期间定期推进已核对的历史，避免长时间打开客户端耗尽日志保留窗口
pub fn checkpoint(cache: &Path, scopes: &[String]) -> bool {
    incremental(cache, scopes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};

    fn svn(root: &Path, args: &[&str]) {
        let output = Command::new("svn")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn real_history_uses_incremental_status_and_checks_commits() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = temporary.path().join("repo");
        assert!(Command::new("svnadmin")
            .arg("create")
            .arg(&repo)
            .status()
            .unwrap()
            .success());
        let url = format!("file:///{}", repo.to_string_lossy().replace('\\', "/"));
        svn(temporary.path(), &["checkout", &url, "wc"]);
        let root = temporary.path().join("wc");
        fs::write(root.join("source.txt"), "base\r\n").unwrap();
        svn(&root, &["add", "source.txt"]);
        svn(&root, &["commit", "-m", "initial"]);
        let cache = temporary.path().join("cache");
        let scopes = vec![root.to_string_lossy().into_owned()];
        let first = open(Some(&cache), &scopes).unwrap();
        assert!(!first.incremental);
        if scan_history::read(&cache, &scopes)
            .unwrap()
            .checkpoint
            .is_none()
        {
            eprintln!("journal unavailable: verified full-scan fallback");
            return;
        }
        let unchanged = open(Some(&cache), &scopes).unwrap();
        assert!(unchanged.incremental, "{}", unchanged.reason);
        fs::write(root.join("source.txt"), "changed\r\n").unwrap();
        fs::write(root.join("new.txt"), "new\r\n").unwrap();
        let changed = open(Some(&cache), &scopes).unwrap();
        assert!(changed.incremental, "{}", changed.reason);
        assert!(changed
            .scan
            .changes
            .iter()
            .any(|change| change.name == "source.txt" && change.item == "modified"));
        assert!(changed
            .scan
            .changes
            .iter()
            .any(|change| change.name == "new.txt" && change.item == "unversioned"));
        fs::remove_file(root.join("new.txt")).unwrap();
        let deleted = open(Some(&cache), &scopes).unwrap();
        assert!(deleted.incremental, "{}", deleted.reason);
        assert!(!deleted
            .scan
            .changes
            .iter()
            .any(|change| change.name == "new.txt"));
        svn(&root, &["commit", "-m", "save"]);
        let committed = open(Some(&cache), &scopes).unwrap();
        assert!(!committed.incremental);
        assert!(committed.scan.changes.is_empty());
    }
}
