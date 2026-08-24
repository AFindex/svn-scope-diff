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
