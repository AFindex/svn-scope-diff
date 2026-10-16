use crate::{path_scope, svn};
use notify::{event::ModifyKind, Event, EventKind};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// 缓存目录状态，生成目录中的持续写入无需重复启动 SVN
#[derive(Default)]
pub(crate) struct WatchPathFilter {
    directory_status: HashMap<String, String>,
}

impl WatchPathFilter {
    // SVN 元数据变化或事件丢失后重新核对忽略状态
    pub(crate) fn clear(&mut self) {
        self.directory_status.clear();
    }

    // 创建、删除、重命名后重新检查该目录，避免沿用同名旧目录的状态
    pub(crate) fn invalidate_event(&mut self, event: &Event) {
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        ) {
            return;
        }
        for path in &event.paths {
            self.directory_status
                .retain(|key, _| !path_scope::path_is_within(Path::new(key), path));
        }
    }

    // 从工作副本根目录检查忽略祖先，已版本化的同名目录继续监听
    pub(crate) fn is_ignored(&mut self, path: &Path, wc_root: &Path) -> Result<bool, String> {
        let mut ancestors: Vec<PathBuf> = path
            .ancestors()
            .take_while(|ancestor| path_scope::path_is_within(ancestor, wc_root))
            .map(Path::to_path_buf)
            .collect();
        ancestors.reverse();
        for ancestor in ancestors {
            let key = path_scope::path_key(&ancestor);
            let status = if let Some(status) = self.directory_status.get(&key) {
                status.clone()
            } else {
                let status = svn::watch_path_status(&ancestor)?;
                if ancestor.is_dir() {
                    self.directory_status.insert(key, status.clone());
                }
                status
            };
            if status == "ignored" {
                return Ok(true);
            }
            if status == "unversioned" {
                return Ok(false);
            }
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RenameMode};
    use std::{fs, process::Command};

    fn svn(arguments: &[&str], root: &Path) {
        let output = Command::new("svn")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn ignored_generated_files_do_not_hide_source_or_versioned_files() {
        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repository");
        let root = temporary.path().join("wc");
        assert!(Command::new("svnadmin")
            .arg("create")
            .arg(&repository)
            .status()
            .unwrap()
            .success());
        let url = format!(
            "file:///{}",
            repository.to_string_lossy().replace('\\', "/")
        );
        svn(
            &["checkout", &url, root.to_str().unwrap()],
            temporary.path(),
        );
        fs::create_dir_all(root.join("src/Library")).unwrap();
        fs::write(root.join("src/Library/tracked.cs"), "base\r\n").unwrap();
        fs::write(root.join("src/SpawnItemClip.cs"), "base\r\n").unwrap();
        svn(&["add", "--no-ignore", "src"], &root);
        svn(&["commit", "-m", "initial"], &root);
        svn(
            &["propset", "svn:ignore", "scope-test-cache\nTemp\n*.tmp", "."],
            &root,
        );
        svn(&["propset", "svn:ignore", "Library", "src"], &root);
        fs::create_dir_all(root.join("scope-test-cache/BurstCache")).unwrap();
        fs::create_dir_all(root.join("Temp/Burst")).unwrap();

        let mut filter = WatchPathFilter::default();
        for index in 0..200 {
            let generated = root.join(format!("scope-test-cache/BurstCache/{index}.obj"));
            fs::write(&generated, "generated\r\n").unwrap();
            assert!(filter.is_ignored(&generated, &root).unwrap());
        }
        // 只缓存工作副本与忽略目录，不为 200 个生成文件逐个查询状态
        assert_eq!(filter.directory_status.len(), 2);
        assert!(filter
            .is_ignored(&root.join("Temp/Burst/deleted.tmp"), &root)
            .unwrap());
        fs::write(root.join("scratch.tmp"), "ignored\r\n").unwrap();
        assert!(filter.is_ignored(&root.join("scratch.tmp"), &root).unwrap());
        fs::write(root.join("src/SpawnItemClip.cs"), "modified\r\n").unwrap();
        assert!(!filter
            .is_ignored(&root.join("src/SpawnItemClip.cs"), &root)
            .unwrap());
        assert!(!filter
            .is_ignored(&root.join("src/Library/tracked.cs"), &root)
            .unwrap());
        fs::create_dir_all(root.join("new-folder/nested")).unwrap();
        assert!(!filter
            .is_ignored(&root.join("new-folder/nested/new.cs"), &root)
            .unwrap());

        // 元数据变化后清理缓存：取消忽略或强制 add 后必须重新识别
        svn(&["propdel", "svn:ignore", "."], &root);
        filter.clear();
        assert!(!filter
            .is_ignored(&root.join("scope-test-cache/BurstCache/0.obj"), &root)
            .unwrap());
        svn(&["propset", "svn:ignore", "scope-test-cache", "."], &root);
        filter.clear();
        assert!(filter
            .is_ignored(&root.join("scope-test-cache/BurstCache/0.obj"), &root)
            .unwrap());
        svn(&["add", "--force", "--no-ignore", "scope-test-cache"], &root);
        filter.clear();
        assert!(!filter
            .is_ignored(&root.join("scope-test-cache/BurstCache/0.obj"), &root)
            .unwrap());
    }

    #[test]
    fn creating_or_renaming_a_directory_invalidates_its_cached_descendants() {
        let root = std::env::temp_dir().join("watch-filter-test");
        let path = root.join("old");
        let mut filter = WatchPathFilter::default();
        for kind in [
            EventKind::Create(CreateKind::Folder),
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
        ] {
            filter
                .directory_status
                .insert(path_scope::path_key(&root), "normal".into());
            filter
                .directory_status
                .insert(path_scope::path_key(&path), "ignored".into());
            filter
                .directory_status
                .insert(path_scope::path_key(&path.join("nested")), "normal".into());
            filter.invalidate_event(&Event::new(kind).add_path(path.clone()));
            assert_eq!(filter.directory_status.len(), 1);
        }
    }
}
