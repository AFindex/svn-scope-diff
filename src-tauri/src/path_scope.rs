use std::path::{Path, PathBuf};

pub fn validate_scope(directory: &str, wc_root: &str) -> Result<(PathBuf, PathBuf), String> {
    let scope = absolute_path(directory, "当前目录")?;
    let working_copy_root = absolute_path(wc_root, "SVN 工作副本根目录")?;
    if !path_is_within(&scope, &working_copy_root) {
        return Err("当前目录不在扫描结果声明的 SVN 工作副本内。".to_owned());
    }
    Ok((scope, working_copy_root))
}

pub fn validate_target(
    value: &str,
    scope: &Path,
    working_copy_root: &Path,
    label: &str,
) -> Result<PathBuf, String> {
    let target = absolute_path(value, label)?;
    if !path_is_within(&target, scope) || !path_is_within(&target, working_copy_root) {
        return Err(format!(
            "拒绝操作当前扫描范围之外的路径：{}",
            target.display()
        ));
    }
    Ok(target)
}

pub fn absolute_path(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{label}不是绝对路径：{}", path.display()));
    }
    std::path::absolute(&path)
        .map_err(|error| format!("无法解析{label} {}：{error}", path.display()))
}

pub fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}

pub fn path_is_within(path: &Path, directory: &Path) -> bool {
    let path = path_key(path);
    let directory = path_key(directory);
    path == directory || path.starts_with(&format!("{directory}\\"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_check_does_not_match_similar_sibling_names() {
        assert!(path_is_within(
            Path::new(r"F:\wc\src\main.cs"),
            Path::new(r"F:\wc\src")
        ));
        assert!(!path_is_within(
            Path::new(r"F:\wc\src-old\main.cs"),
            Path::new(r"F:\wc\src")
        ));
    }

    #[test]
    fn validates_targets_inside_both_scope_boundaries() {
        let (scope, root) = validate_scope(r"F:\wc\src", r"F:\wc").unwrap();
        assert!(validate_target(r"F:\wc\src\main.cs", &scope, &root, "目标").is_ok());
        assert!(validate_target(r"F:\wc\tests\main.cs", &scope, &root, "目标").is_err());
    }
}
