use crate::models::{ChangeEntry, DiffResult, FileFingerprint, ScanResult};
use encoding_rs::{GBK, UTF_16BE, UTF_16LE};
use quick_xml::de::from_str;
use serde::Deserialize;
use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

static SVN_INSTALLATION: OnceLock<Result<SvnInstallation, String>> = OnceLock::new();

#[derive(Clone)]
struct SvnInstallation {
    executable: PathBuf,
    version: String,
}

#[derive(Debug, Deserialize)]
struct StatusDocument {
    #[serde(rename = "target", default)]
    targets: Vec<StatusTarget>,
}

#[derive(Debug, Deserialize)]
struct StatusTarget {
    #[serde(rename = "@path")]
    path: String,
    #[serde(rename = "entry", default)]
    entries: Vec<StatusEntry>,
}

#[derive(Debug, Deserialize)]
struct StatusEntry {
    #[serde(rename = "@path")]
    path: String,
    #[serde(rename = "wc-status")]
    status: WorkingCopyStatus,
}

#[derive(Debug, Deserialize)]
struct WorkingCopyStatus {
    #[serde(rename = "@item")]
    item: String,
    #[serde(rename = "@props", default = "default_props")]
    props: String,
    #[serde(rename = "@tree-conflicted", default)]
    tree_conflicted: bool,
    #[serde(rename = "@revision", default)]
    revision: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InfoDocument {
    #[serde(rename = "entry", default)]
    entries: Vec<InfoEntry>,
}

#[derive(Debug, Deserialize)]
struct InfoEntry {
    #[serde(rename = "@kind")]
    kind: String,
    #[serde(rename = "@revision", default)]
    revision: Option<String>,
    #[serde(rename = "wc-info", default)]
    wc_info: Option<WorkingCopyInfo>,
}

#[derive(Debug, Deserialize)]
struct WorkingCopyInfo {
    #[serde(rename = "wcroot-abspath", default)]
    wcroot_abspath: Option<String>,
}

fn default_props() -> String {
    "none".to_owned()
}

pub fn scan(directory: &str) -> Result<ScanResult, String> {
    let selected = normalize_existing_directory(directory)?;
    let (wc_root, revision) = working_copy_metadata(&selected)?;

    let output = run_svn([
        OsString::from("status"),
        OsString::from("--xml"),
        OsString::from("--depth"),
        OsString::from("infinity"),
        OsString::from("--ignore-externals"),
        OsString::from("--"),
        svn_target(&selected),
    ])?;
    let xml = String::from_utf8(output.stdout)
        .map_err(|_| "svn status 返回的 XML 不是有效 UTF-8".to_owned())?;
    let mut changes = parse_status_xml(&xml, &selected)?;
    populate_missing_kinds(&mut changes);

    changes.sort_by_cached_key(|change| change.relative_path.to_lowercase());

    let svn_version = svn_version()?;

    Ok(ScanResult {
        directory: path_string(&selected),
        wc_root: path_string(&wc_root),
        revision,
        svn_version,
        changes,
    })
}

pub fn file_diff(
    path: &str,
    item: &str,
    is_directory: bool,
    base_revision: Option<&str>,
) -> Result<DiffResult, String> {
    let target = PathBuf::from(path);
    let is_directory = is_directory || target.is_dir();

    if is_directory {
        return Ok(DiffResult {
            path: path_string(&target),
            original: String::new(),
            modified: String::new(),
            original_label: "BASE".to_owned(),
            modified_label: "工作副本".to_owned(),
            original_encoding: "-".to_owned(),
            modified_encoding: "-".to_owned(),
            original_bytes: 0,
            modified_bytes: 0,
            is_binary: false,
            is_directory: true,
            truncated: false,
            note: Some("这是目录变更；目录本身没有可展示的文本内容。".to_owned()),
        });
    }

    let base_bytes = if matches!(item, "added" | "unversioned") {
        Vec::new()
    } else {
        svn_base_bytes(&target).unwrap_or_default()
    };
    let working_bytes = if matches!(item, "deleted" | "missing") {
        Vec::new()
    } else {
        fs::read(&target)
            .map_err(|error| format!("无法读取工作文件 {}：{error}", target.display()))?
    };

    let base_binary = looks_binary(&base_bytes);
    let working_binary = looks_binary(&working_bytes);
    let is_binary = base_binary || working_binary;
    let original_label = base_revision
        .map(|value| format!("BASE · r{}", value.trim()))
        .unwrap_or_else(|| "BASE".to_owned());

    if is_binary {
        return Ok(DiffResult {
            path: path_string(&target),
            original: String::new(),
            modified: String::new(),
            original_label,
            modified_label: "工作副本".to_owned(),
            original_encoding: "binary".to_owned(),
            modified_encoding: "binary".to_owned(),
            original_bytes: base_bytes.len(),
            modified_bytes: working_bytes.len(),
            is_binary: true,
            is_directory: false,
            truncated: false,
            note: Some(
                "检测到二进制内容。可使用 Beyond Compare 查看图片、压缩包或十六进制差异。"
                    .to_owned(),
            ),
        });
    }

    let base = decode_text(&base_bytes);
    let working = decode_text(&working_bytes);
    let (original, base_truncated) = truncate_text(base.text);
    let (modified, working_truncated) = truncate_text(working.text);
    let truncated = base_truncated || working_truncated;

    Ok(DiffResult {
        path: path_string(&target),
        original,
        modified,
        original_label,
        modified_label: "工作副本".to_owned(),
        original_encoding: base.encoding,
        modified_encoding: working.encoding,
        original_bytes: base_bytes.len(),
        modified_bytes: working_bytes.len(),
        is_binary: false,
        is_directory: false,
        truncated,
        note: truncated.then(|| {
            "文件较大，内嵌视图仅显示前 2 MiB；Beyond Compare 会打开完整文件。".to_owned()
        }),
    })
}

pub fn file_fingerprint(path: &str) -> Result<FileFingerprint, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(FileFingerprint {
            exists: true,
            is_directory: metadata.is_dir(),
            size: metadata.len(),
            modified_ns: metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos().to_string()),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileFingerprint {
            exists: false,
            is_directory: false,
            size: 0,
            modified_ns: None,
        }),
        Err(error) => Err(format!("无法读取文件状态 {path}：{error}")),
    }
}

pub fn svn_base_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let output = run_svn([
        OsString::from("cat"),
        OsString::from("-r"),
        OsString::from("BASE"),
        OsString::from("--"),
        svn_target(path),
    ])?;
    Ok(output.stdout)
}

pub fn property_diff(path: &str) -> Result<Option<String>, String> {
    let path = Path::new(path);
    let output = run_svn([
        OsString::from("diff"),
        OsString::from("--properties-only"),
        OsString::from("--internal-diff"),
        OsString::from("--"),
        svn_target(path),
    ])?;
    let value = String::from_utf8_lossy(&output.stdout).into_owned();
    Ok((!value.trim().is_empty()).then_some(value))
}

fn parse_status_xml(xml: &str, selected: &Path) -> Result<Vec<ChangeEntry>, String> {
    let document: StatusDocument =
        from_str(xml).map_err(|error| format!("无法解析 svn status XML：{error}"))?;
    let mut changes = Vec::new();

    for target in document.targets {
        let target_path = PathBuf::from(target.path);
        for entry in target.entries {
            if !is_interesting(&entry.status) {
                continue;
            }
            let status = entry.status;

            let raw_path = PathBuf::from(&entry.path);
            let absolute = if raw_path.is_absolute() {
                raw_path
            } else if target_path.is_absolute() {
                target_path.join(raw_path)
            } else {
                selected.join(raw_path)
            };
            if !path_is_within(&absolute, selected) {
                continue;
            }

            let relative = absolute
                .strip_prefix(selected)
                .map(path_string)
                .unwrap_or_else(|_| path_string(&absolute));
            let relative = if relative.is_empty() {
                ".".to_owned()
            } else {
                relative.replace('\\', "/")
            };
            let name = absolute
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| path_string(&absolute));

            changes.push(ChangeEntry {
                path: path_string(&absolute),
                relative_path: relative,
                name,
                status_code: status_code(&status),
                is_directory: absolute.is_dir(),
                item: status.item,
                properties: status.props,
                tree_conflicted: status.tree_conflicted,
                base_revision: status.revision,
            });
        }
    }

    infer_directory_entries(&mut changes);

    Ok(changes)
}

fn infer_directory_entries(changes: &mut [ChangeEntry]) {
    let mut ancestor_paths = HashSet::new();
    for change in changes.iter() {
        let mut path = change.relative_path.as_str();
        while let Some((parent, _)) = path.rsplit_once('/') {
            if parent.is_empty() {
                break;
            }
            ancestor_paths.insert(parent.to_owned());
            path = parent;
        }
    }

    for change in changes {
        if ancestor_paths.contains(&change.relative_path) {
            change.is_directory = true;
        }
    }
}

fn is_interesting(status: &WorkingCopyStatus) -> bool {
    !matches!(
        status.item.as_str(),
        "normal" | "none" | "external" | "ignored"
    ) || matches!(status.props.as_str(), "modified" | "conflicted")
        || status.tree_conflicted
}

fn status_code(status: &WorkingCopyStatus) -> String {
    if status.tree_conflicted || status.item == "conflicted" || status.props == "conflicted" {
        return "C".to_owned();
    }
    match status.item.as_str() {
        "added" => "A",
        "deleted" => "D",
        "missing" | "incomplete" => "!",
        "modified" => "M",
        "obstructed" => "~",
        "replaced" => "R",
        "unversioned" => "?",
        "merged" => "G",
        _ if status.props == "modified" => "M",
        _ => "•",
    }
    .to_owned()
}

fn normalize_existing_directory(directory: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(directory);
    if !path.exists() {
        return Err(format!("目录不存在：{}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("请选择目录，而不是文件：{}", path.display()));
    }
    std::path::absolute(&path).map_err(|error| format!("无法解析目录 {}：{error}", path.display()))
}

fn working_copy_metadata(selected: &Path) -> Result<(PathBuf, Option<String>), String> {
    let info = match svn_info(selected) {
        Ok(info) => info,
        Err(_) => {
            let local_root = selected
                .ancestors()
                .find(|path| path.join(".svn").is_dir())
                .ok_or_else(|| {
                    format!(
                        "“{}” 不在 SVN 工作副本中。请选择已 checkout 项目内的目录。",
                        selected.display()
                    )
                })?;
            svn_info(local_root)
                .map_err(|_| format!("“{}” 不在可读取的 SVN 工作副本中。", selected.display()))?
        }
    };

    let wc_root = info
        .wc_info
        .and_then(|wc_info| wc_info.wcroot_abspath)
        .map(PathBuf::from)
        .or_else(|| {
            selected
                .ancestors()
                .find(|path| path.join(".svn").is_dir())
                .map(Path::to_path_buf)
        })
        .ok_or_else(|| format!("无法确定 SVN 工作副本根目录：{}", selected.display()))?;
    let wc_root = std::path::absolute(&wc_root).unwrap_or(wc_root);
    Ok((wc_root, info.revision))
}

fn svn_info(path: &Path) -> Result<InfoEntry, String> {
    svn_info_entries(&[path.to_path_buf()])?
        .into_iter()
        .next()
        .ok_or_else(|| format!("svn info 没有返回目标信息：{}", path.display()))
}

fn svn_info_entries(paths: &[PathBuf]) -> Result<Vec<InfoEntry>, String> {
    let mut arguments = vec![
        OsString::from("info"),
        OsString::from("--xml"),
        OsString::from("--depth"),
        OsString::from("empty"),
        OsString::from("--"),
    ];
    arguments.extend(paths.iter().map(|path| svn_target(path)));
    let output = run_svn(arguments)?;
    let xml = String::from_utf8(output.stdout)
        .map_err(|_| "svn info 返回的 XML 不是有效 UTF-8".to_owned())?;
    let document: InfoDocument =
        from_str(&xml).map_err(|error| format!("无法解析 svn info XML：{error}"))?;
    Ok(document.entries)
}

fn populate_missing_kinds(changes: &mut [ChangeEntry]) {
    let unresolved: Vec<(usize, PathBuf)> = changes
        .iter()
        .enumerate()
        .filter(|(_, change)| {
            !change.is_directory && matches!(change.item.as_str(), "deleted" | "missing")
        })
        .map(|(index, change)| (index, PathBuf::from(&change.path)))
        .collect();

    for chunk in unresolved.chunks(32) {
        let targets: Vec<PathBuf> = chunk.iter().map(|(_, path)| path.clone()).collect();
        match svn_info_entries(&targets) {
            Ok(entries) if entries.len() == chunk.len() => {
                for ((index, _), entry) in chunk.iter().zip(entries) {
                    changes[*index].is_directory = entry.kind == "dir";
                }
            }
            _ => {
                for (index, path) in chunk {
                    if let Ok(entry) = svn_info(path) {
                        changes[*index].is_directory = entry.kind == "dir";
                    }
                }
            }
        }
    }
}

fn svn_version() -> Result<String, String> {
    Ok(svn_installation()?.version)
}

pub(crate) fn executable_path() -> Result<PathBuf, String> {
    Ok(svn_installation()?.executable)
}

pub(crate) fn working_copy_root(path: &Path) -> Result<PathBuf, String> {
    Ok(working_copy_metadata(path)?.0)
}

pub(crate) fn target_argument(path: &Path) -> OsString {
    svn_target(path)
}

fn run_svn<I, S>(arguments: I) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let installation = svn_installation()?;
    let mut command = Command::new(&installation.executable);
    command.args(arguments);
    configure_no_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("无法启动 {}：{error}", installation.executable.display()))?;
    if output.status.success() {
        Ok(output)
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if detail.is_empty() {
            format!("svn 命令执行失败（退出码 {:?}）", output.status.code())
        } else {
            detail
        })
    }
}

fn svn_installation() -> Result<SvnInstallation, String> {
    SVN_INSTALLATION.get_or_init(locate_svn).clone()
}

fn locate_svn() -> Result<SvnInstallation, String> {
    let mut candidates = Vec::new();
    if let Some(value) = std::env::var_os("SVN_SCOPE_SVN_EXE") {
        candidates.push(PathBuf::from(value));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("svn.exe"));
            candidates.push(parent.join("tools").join("svn.exe"));
        }
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root);
            candidates.push(root.join("TortoiseSVN").join("bin").join("svn.exe"));
            candidates.push(root.join("SlikSvn").join("bin").join("svn.exe"));
            candidates.push(root.join("VisualSVN Server").join("bin").join("svn.exe"));
        }
    }
    candidates.push(PathBuf::from(if cfg!(windows) { "svn.exe" } else { "svn" }));

    for candidate in candidates {
        let mut command = Command::new(&candidate);
        command.args(["--version", "--quiet"]);
        configure_no_window(&mut command);
        if let Ok(output) = command.output() {
            if output.status.success() {
                return Ok(SvnInstallation {
                    executable: candidate,
                    version: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
                });
            }
        }
    }

    Err("未找到 svn 命令行客户端。请安装 TortoiseSVN（勾选 command line client tools），或设置 SVN_SCOPE_SVN_EXE。".to_owned())
}

fn svn_target(path: &Path) -> OsString {
    let mut value = path.as_os_str().to_owned();
    if path.to_string_lossy().contains('@') {
        value.push("@");
    }
    value
}

fn path_is_within(candidate: &Path, parent: &Path) -> bool {
    if cfg!(windows) {
        let candidate = path_string(candidate).replace('/', "\\").to_lowercase();
        let parent = path_string(parent)
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase();
        candidate == parent || candidate.starts_with(&(parent + "\\"))
    } else {
        candidate.starts_with(parent)
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn configure_no_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

struct DecodedText {
    text: String,
    encoding: String,
}

fn decode_text(bytes: &[u8]) -> DecodedText {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return DecodedText {
            text: String::from_utf8_lossy(&bytes[3..]).into_owned(),
            encoding: "UTF-8 BOM".to_owned(),
        };
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = UTF_16LE.decode(&bytes[2..]);
        return DecodedText {
            text: text.into_owned(),
            encoding: "UTF-16 LE".to_owned(),
        };
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = UTF_16BE.decode(&bytes[2..]);
        return DecodedText {
            text: text.into_owned(),
            encoding: "UTF-16 BE".to_owned(),
        };
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return DecodedText {
            text: text.to_owned(),
            encoding: "UTF-8".to_owned(),
        };
    }
    let (text, _, had_errors) = GBK.decode(bytes);
    DecodedText {
        text: text.into_owned(),
        encoding: if had_errors {
            "GBK（替换无效字节）"
        } else {
            "GBK"
        }
        .to_owned(),
    }
}

fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return false;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.contains(&0) {
        return true;
    }
    let controls = sample
        .iter()
        .filter(|byte| **byte < 0x09 || (**byte > 0x0D && **byte < 0x20))
        .count();
    controls * 100 > sample.len().max(1) * 2
}

fn truncate_text(mut text: String) -> (String, bool) {
    if text.len() <= MAX_TEXT_BYTES {
        return (text, false);
    }
    let mut boundary = MAX_TEXT_BYTES;
    while !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    text.truncate(boundary);
    text.push_str("\n\n… SVN Scope：内嵌预览已在 2 MiB 处截断 …\n");
    (text, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn parses_only_scoped_interesting_statuses() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="C:\work\demo\src">
    <entry path="C:\work\demo\src\main.ts"><wc-status item="modified" revision="7" props="none" /></entry>
    <entry path="C:\work\demo\src\new.ts"><wc-status item="unversioned" props="none" /></entry>
    <entry path="C:\work\demo\src\clean.ts"><wc-status item="normal" revision="7" props="none" /></entry>
    <entry path="C:\work\demo\parent.ts"><wc-status item="modified" revision="7" props="none" /></entry>
  </target>
</status>"#;
        let changes = parse_status_xml(xml, Path::new(r"C:\work\demo\src")).unwrap();
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].relative_path, "main.ts");
        assert_eq!(changes[0].status_code, "M");
        assert_eq!(changes[0].base_revision.as_deref(), Some("7"));
        assert_eq!(changes[1].status_code, "?");
        assert_eq!(changes[1].base_revision, None);
    }

    #[test]
    fn infers_changed_directory_from_descendant_paths() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="C:\work\demo\src">
    <entry path="C:\work\demo\src\removed"><wc-status item="deleted" revision="7" props="none" /></entry>
    <entry path="C:\work\demo\src\removed\child.txt"><wc-status item="deleted" revision="7" props="none" /></entry>
  </target>
</status>"#;
        let changes = parse_status_xml(xml, Path::new(r"C:\work\demo\src")).unwrap();
        let directory = changes
            .iter()
            .find(|change| change.relative_path == "removed")
            .unwrap();
        assert!(directory.is_directory);
    }

    #[test]
    fn detects_property_only_change() {
        let status = WorkingCopyStatus {
            item: "normal".to_owned(),
            props: "modified".to_owned(),
            tree_conflicted: false,
            revision: Some("7".to_owned()),
        };
        assert!(is_interesting(&status));
        assert_eq!(status_code(&status), "M");
    }

    #[test]
    fn decodes_utf16_before_binary_detection() {
        let bytes = [0xFF, 0xFE, b'h', 0, b'i', 0];
        assert!(!looks_binary(&bytes));
        assert_eq!(decode_text(&bytes).text, "hi");
    }

    #[test]
    fn detects_file_fingerprint_changes_and_deletion() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("watched.txt");
        fs::write(&path, "one").unwrap();
        let initial = file_fingerprint(path.to_str().unwrap()).unwrap();

        fs::write(&path, "longer content").unwrap();
        let updated = file_fingerprint(path.to_str().unwrap()).unwrap();
        assert_ne!(initial, updated);
        assert!(updated.exists);

        fs::remove_file(&path).unwrap();
        let deleted = file_fingerprint(path.to_str().unwrap()).unwrap();
        assert!(!deleted.exists);
    }

    #[test]
    fn real_svn_scan_stays_below_selected_directory() {
        if Command::new("svnadmin")
            .args(["--version", "--quiet"])
            .output()
            .map(|output| !output.status.success())
            .unwrap_or(true)
        {
            eprintln!("skipped: svnadmin is not installed");
            return;
        }

        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repository");
        let working_copy = temporary.path().join("working-copy");
        run_checked(Command::new("svnadmin").arg("create").arg(&repository));

        let repository_url = format!(
            "file:///{}",
            repository.to_string_lossy().replace('\\', "/")
        );
        let trunk_url = format!("{repository_url}/trunk");
        run_checked(
            Command::new("svn")
                .arg("mkdir")
                .arg(&trunk_url)
                .args(["-m", "create trunk"]),
        );
        run_checked(
            Command::new("svn")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&working_copy),
        );

        let selected = working_copy.join("src");
        let removed_directory = selected.join("removed-dir");
        let missing_file = selected.join("missing.txt");
        fs::create_dir_all(&selected).unwrap();
        fs::create_dir_all(&removed_directory).unwrap();
        fs::write(working_copy.join("parent.txt"), "parent base\n").unwrap();
        fs::write(selected.join("child.txt"), "child base\n").unwrap();
        fs::write(&missing_file, "missing base\n").unwrap();
        fs::write(removed_directory.join("nested.txt"), "removed base\n").unwrap();
        run_checked(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("parent.txt"))
                .arg(&selected),
        );
        run_checked(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "initial files"]),
        );

        fs::write(working_copy.join("parent.txt"), "parent changed\n").unwrap();
        fs::write(selected.join("child.txt"), "child changed\n").unwrap();
        fs::write(selected.join("new.txt"), "new file\n").unwrap();
        run_checked(
            Command::new("svn")
                .arg("propset")
                .arg("perf")
                .arg("yes")
                .arg(selected.join("child.txt")),
        );
        run_checked(Command::new("svn").arg("delete").arg(&removed_directory));
        fs::remove_file(&missing_file).unwrap();

        let result = scan(selected.to_str().unwrap()).unwrap();
        let paths: Vec<&str> = result
            .changes
            .iter()
            .map(|change| change.relative_path.as_str())
            .collect();
        assert!(paths.contains(&"child.txt"));
        assert!(paths.contains(&"new.txt"));
        assert!(!paths.contains(&"../parent.txt"));

        let child = result
            .changes
            .iter()
            .find(|change| change.relative_path == "child.txt")
            .unwrap();
        assert_eq!(child.base_revision.as_deref(), Some("2"));
        let diff = file_diff(
            &child.path,
            &child.item,
            child.is_directory,
            child.base_revision.as_deref(),
        )
        .unwrap();
        assert_eq!(diff.original, "child base\n");
        assert_eq!(diff.modified, "child changed\n");
        assert_eq!(diff.original_label, "BASE · r2");

        let properties = property_diff(&child.path).unwrap().unwrap();
        assert!(properties.contains("perf"));

        let removed = result
            .changes
            .iter()
            .find(|change| change.relative_path == "removed-dir")
            .unwrap();
        assert!(removed.is_directory);

        let missing = result
            .changes
            .iter()
            .find(|change| change.relative_path == "missing.txt")
            .unwrap();
        assert!(!missing.is_directory);
    }

    fn run_checked(command: &mut Command) {
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
