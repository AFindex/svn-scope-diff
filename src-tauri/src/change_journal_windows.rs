use super::Checkpoint;
use crate::path_scope;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::Ioctl::*;
use windows_sys::Win32::System::IO::DeviceIoControl;

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn checked_handle(handle: HANDLE) -> Result<Handle, String> {
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!(
            "无法读取文件变更记录：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(Handle(handle))
}

fn open_volume(volume: &str) -> Result<Handle, String> {
    let name: Vec<u16> = OsStr::new(&format!(r"\\.\{volume}"))
        .encode_wide()
        .chain(Some(0))
        .collect();
    checked_handle(unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    })
}

fn control(handle: &Handle, code: u32, input: &[u8], output: &mut [u8]) -> Result<usize, String> {
    let mut count = 0;
    let success = unsafe {
        DeviceIoControl(
            handle.0,
            code,
            input.as_ptr().cast(),
            input.len() as u32,
            output.as_mut_ptr().cast(),
            output.len() as u32,
            &mut count,
            std::ptr::null_mut(),
        )
    };
    if success == 0 {
        return Err(format!(
            "NTFS 日志不可用：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(count as usize)
}

fn query(handle: &Handle, volume: &str) -> Result<(Checkpoint, i64), String> {
    let mut output = [0u8; 128];
    let count = control(handle, FSCTL_QUERY_USN_JOURNAL, &[], &mut output)?;
    if count < 56 {
        return Err("NTFS 日志信息不完整".into());
    }
    Ok((
        Checkpoint {
            volume: volume.into(),
            journal_id: u64_at(&output, 0),
            next_usn: i64_at(&output, 16),
        },
        i64_at(&output, 8).max(i64_at(&output, 24)),
    ))
}

pub(super) fn checkpoint(path: &Path) -> Result<Checkpoint, String> {
    let path = path.to_string_lossy();
    let bytes = path.as_bytes();
    if bytes.len() < 3 || bytes[1] != b':' || !bytes[0].is_ascii_alphabetic() {
        return Err("此目录不是本机 NTFS 盘符路径".into());
    }
    let volume = &path[..2];
    query(&open_volume(volume)?, volume).map(|value| value.0)
}

#[derive(Debug)]
struct Record {
    id: u64,
    parent: u64,
    reason: u32,
    name: String,
}
fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}
fn i64_at(bytes: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

fn parse_records(bytes: &[u8], end: i64, records: &mut Vec<Record>) -> Result<i64, String> {
    if bytes.len() < 8 {
        return Err("NTFS 日志返回空记录".into());
    }
    let mut offset = 8;
    while offset < bytes.len() {
        let entry = &bytes[offset..];
        if entry.len() < 60 {
            return Err("NTFS 日志记录被截断".into());
        }
        let length = u32::from_le_bytes(entry[..4].try_into().unwrap()) as usize;
        let version = u16::from_le_bytes(entry[4..6].try_into().unwrap());
        if length < 60 || length > entry.len() || version != 2 {
            return Err("NTFS 日志格式变化，需要完整核对".into());
        }
        let name_length = u16::from_le_bytes(entry[56..58].try_into().unwrap()) as usize;
        let name_offset = u16::from_le_bytes(entry[58..60].try_into().unwrap()) as usize;
        if name_offset < 60 || name_offset + name_length > length || name_length % 2 != 0 {
            return Err("NTFS 文件名记录无效".into());
        }
        if i64_at(entry, 24) < end {
            let name: Vec<u16> = entry[name_offset..name_offset + name_length]
                .chunks_exact(2)
                .map(|part| u16::from_le_bytes([part[0], part[1]]))
                .collect();
            records.push(Record {
                id: u64_at(entry, 8),
                parent: u64_at(entry, 16),
                reason: u32::from_le_bytes(entry[40..44].try_into().unwrap()),
                name: String::from_utf16(&name).map_err(|_| "NTFS 文件名无法解码")?,
            });
        }
        offset += length;
    }
    Ok(i64_at(bytes, 0))
}

fn read_records(handle: &Handle, saved: &Checkpoint, end: i64) -> Result<Vec<Record>, String> {
    let mut cursor = saved.next_usn;
    let mut records = Vec::new();
    let mut output = vec![0u8; 65536];
    while cursor < end {
        let mut input = [0u8; 40];
        input[..8].copy_from_slice(&cursor.to_le_bytes());
        input[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        input[32..40].copy_from_slice(&saved.journal_id.to_le_bytes());
        let count = control(handle, FSCTL_READ_USN_JOURNAL, &input, &mut output)?;
        let next = parse_records(&output[..count], end, &mut records)?;
        if next <= cursor {
            return Err("NTFS 日志未能推进，需要完整核对".into());
        }
        cursor = next;
    }
    Ok(records)
}

fn path_by_id(handle: &Handle, id: u64) -> Result<PathBuf, String> {
    let descriptor = FILE_ID_DESCRIPTOR {
        dwSize: std::mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
        Type: FileIdType,
        Anonymous: FILE_ID_DESCRIPTOR_0 { FileId: id as i64 },
    };
    let file = checked_handle(unsafe {
        OpenFileById(
            handle.0,
            &descriptor,
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    })?;
    let mut buffer = vec![0u16; 32768];
    let length =
        unsafe { GetFinalPathNameByHandleW(file.0, buffer.as_mut_ptr(), buffer.len() as u32, 0) }
            as usize;
    if length == 0 || length >= buffer.len() {
        return Err("无法还原变更目录路径".into());
    }
    let text = String::from_utf16(&buffer[..length]).map_err(|_| "变更目录名称无法解码")?;
    Ok(PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text)))
}

fn resolve_parent(
    handle: &Handle,
    id: u64,
    links: &HashMap<u64, (u64, String)>,
    paths: &mut HashMap<u64, PathBuf>,
    visiting: &mut HashSet<u64>,
) -> Result<PathBuf, String> {
    if let Some(path) = paths.get(&id) {
        return Ok(path.clone());
    }
    if !visiting.insert(id) {
        return Err("变更目录路径无法可靠还原".into());
    }
    let path = match path_by_id(handle, id) {
        Ok(path) => path,
        Err(_) => {
            let (parent, name) = links
                .get(&id)
                .ok_or("已删除目录缺少父路径记录，需要完整核对")?;
            resolve_parent(handle, *parent, links, paths, visiting)?.join(name)
        }
    };
    visiting.remove(&id);
    paths.insert(id, path.clone());
    Ok(path)
}

pub(super) fn changed_paths(
    saved: &Checkpoint,
    scopes: &[String],
    wc_root: &str,
) -> Result<(Checkpoint, Vec<String>), String> {
    let handle = open_volume(&saved.volume)?;
    let (next, first) = query(&handle, &saved.volume)?;
    if next.journal_id != saved.journal_id
        || saved.next_usn < first
        || saved.next_usn > next.next_usn
    {
        return Err("历史变更日志已失效，需要完整核对".into());
    }
    let records = read_records(&handle, saved, next.next_usn)?;
    let mut links: HashMap<_, _> = records
        .iter()
        .map(|record| (record.id, (record.parent, record.name.clone())))
        .collect();
    let mut parents = HashMap::new();
    let mut paths = HashMap::new();
    let mut extended_links = false;
    // 文件 ID 返回长路径；缓存可能沿用 Windows 的 8.3 短路径
    let canonical = |path: &str| -> Result<PathBuf, String> {
        let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        Ok(PathBuf::from(
            path.to_string_lossy().trim_start_matches(r"\\?\"),
        ))
    };
    let scope_paths: Vec<_> = scopes
        .iter()
        .map(|scope| canonical(scope).map(|path| (scope, path)))
        .collect::<Result<_, _>>()?;
    let admin = canonical(wc_root)?.join(".svn");
    for record in &records {
        let parent = resolve_parent(
            &handle,
            record.parent,
            &links,
            &mut parents,
            &mut HashSet::new(),
        )
        .or_else(|error| {
            if extended_links {
                return Err(error);
            }
            // 读取后有目录被并发删除时，只补齐父路径记录，不推进扫描检查点
            extended_links = true;
            let (tail, _) = query(&handle, &saved.volume)?;
            for extra in read_records(&handle, &next, tail.next_usn)? {
                links.insert(extra.id, (extra.parent, extra.name));
            }
            resolve_parent(
                &handle,
                record.parent,
                &links,
                &mut parents,
                &mut HashSet::new(),
            )
        })?;
        let path = parent.join(&record.name);
        if path_scope::path_is_within(&path, &admin) {
            if record.name == "wc.db" || record.name == "wc.db-wal" {
                return Err("SVN 基线或属性记录发生变化，需要完整核对".into());
            }
            continue;
        }
        if let Some((requested, actual)) = scope_paths
            .iter()
            .find(|(_, scope)| path_scope::path_is_within(&path, scope))
        {
            if record.reason & (USN_REASON_HARD_LINK_CHANGE | USN_REASON_REPARSE_POINT_CHANGE) != 0
            {
                return Err("文件链接关系发生变化，需要完整核对".into());
            }
            let relative: PathBuf = path
                .components()
                .skip(actual.components().count())
                .collect();
            let requested = Path::new(requested).join(relative);
            paths.insert(
                path_scope::path_key(&requested),
                requested.to_string_lossy().into_owned(),
            );
        }
    }
    // 日志可能在读取期间被系统轮换，不能把不完整记录标记为已核对
    let (verified, first) = query(&handle, &saved.volume)?;
    if verified.journal_id != saved.journal_id || saved.next_usn < first {
        return Err("读取期间变更日志已过期".into());
    }
    Ok((next, paths.into_values().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_truncated_and_unknown_records() {
        assert!(parse_records(&[0; 7], 10, &mut Vec::new()).is_err());
        assert!(parse_records(&[0; 20], 10, &mut Vec::new()).is_err());
        let mut bytes = vec![0; 72];
        bytes[8..12].copy_from_slice(&64u32.to_le_bytes());
        bytes[12..14].copy_from_slice(&3u16.to_le_bytes());
        assert!(parse_records(&bytes, 10, &mut Vec::new()).is_err());
    }

    #[test]
    fn real_journal_recovers_writes_renames_and_deleted_parents() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let root = PathBuf::from(root.to_string_lossy().trim_start_matches(r"\\?\"));
        fs::create_dir(root.join("removed")).unwrap();
        fs::write(root.join("removed/file.txt"), "old\r\n").unwrap();
        fs::write(root.join("source.txt"), "old\r\n").unwrap();
        let Ok(saved) = checkpoint(&root) else {
            eprintln!("NTFS journal unavailable; fallback is used on this system");
            return;
        };
        fs::write(root.join("source.txt"), "new\r\n").unwrap();
        fs::rename(root.join("source.txt"), root.join("renamed.txt")).unwrap();
        fs::remove_file(root.join("removed/file.txt")).unwrap();
        fs::remove_dir(root.join("removed")).unwrap();
        let scope = root.to_string_lossy().into_owned();
        let (_, paths) = changed_paths(&saved, &[scope.clone()], &scope).unwrap();
        for name in ["source.txt", "renamed.txt", "removed", "removed/file.txt"] {
            assert!(
                paths
                    .iter()
                    .any(|path| path_scope::path_key(Path::new(path))
                        == path_scope::path_key(&root.join(name))),
                "missing {name}: {paths:?}"
            );
        }
        let mut expired = saved.clone();
        expired.journal_id ^= 1;
        assert!(changed_paths(&expired, &[scope.clone()], &scope).is_err());
    }
}
