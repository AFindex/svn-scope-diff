use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEntry {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub item: String,
    pub properties: String,
    pub status_code: String,
    pub is_directory: bool,
    pub tree_conflicted: bool,
    pub base_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAvailability {
    pub available: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TortoiseSvnAvailability {
    pub available: bool,
    pub path: Option<String>,
    pub auto_select_files: bool,
    pub show_unversioned: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLaunchResult {
    pub selected_count: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvnUpdateStatus {
    pub running: bool,
    pub update_id: Option<u64>,
    pub pid: Option<u32>,
    pub directory: Option<String>,
    pub cancel_requested: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvnUpdateFinished {
    pub update_id: u64,
    pub directory: String,
    pub outcome: String,
    pub exit_code: Option<i32>,
    pub forced: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub directory: String,
    pub wc_root: String,
    pub revision: Option<String>,
    pub svn_version: String,
    pub changes: Vec<ChangeEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub path: String,
    pub original: String,
    pub modified: String,
    pub original_label: String,
    pub modified_label: String,
    pub original_encoding: String,
    pub modified_encoding: String,
    pub original_bytes: usize,
    pub modified_bytes: usize,
    pub is_binary: bool,
    pub is_directory: bool,
    pub truncated: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub exists: bool,
    pub is_directory: bool,
    pub size: u64,
    pub modified_ns: Option<String>,
}
