use crate::path_scope::{validate_scope, validate_target};

pub fn open_change_path(
    action: &str,
    path: &str,
    directory: &str,
    wc_root: &str,
) -> Result<String, String> {
    let (scope, working_copy_root) = validate_scope(directory, wc_root)?;
    let target = validate_target(path, &scope, &working_copy_root, "文件目标")?;

    match action {
        "open" => {
            if !target.exists() {
                return Err(format!(
                    "路径不存在，可能已被删除或移动：{}",
                    target.display()
                ));
            }
            tauri_plugin_opener::open_path(&target, None::<&str>)
                .map_err(|error| format!("无法打开 {}：{error}", target.display()))?;
            Ok(format!("已使用系统默认程序打开：{}", target.display()))
        }
        "reveal" => {
            if target.exists() {
                tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|error| {
                    format!("无法在资源管理器中显示 {}：{error}", target.display())
                })?;
                Ok(format!("已在资源管理器中定位：{}", target.display()))
            } else {
                let parent = target
                    .ancestors()
                    .skip(1)
                    .find(|ancestor| ancestor.is_dir())
                    .ok_or_else(|| format!("找不到可打开的父目录：{}", target.display()))?;
                tauri_plugin_opener::open_path(parent, None::<&str>)
                    .map_err(|error| format!("无法打开父目录 {}：{error}", parent.display()))?;
                Ok(format!(
                    "目标已不存在，已打开其最近存在的父目录：{}",
                    parent.display()
                ))
            }
        }
        _ => Err(format!("不支持的系统路径操作：{action}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_shell_actions_before_launching_anything() {
        let result = open_change_path("unknown", r"F:\wc\src\main.cs", r"F:\wc\src", r"F:\wc");
        assert_eq!(result.unwrap_err(), "不支持的系统路径操作：unknown");
    }
}
