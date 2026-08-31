use crate::models::{SvnUpdateFinished, SvnUpdateStatus};
use crate::{path_scope, svn};
use std::process::{Child, Command, ExitStatus};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::System::Console::{
    AttachConsole, FreeConsole, GenerateConsoleCtrlEvent, GetConsoleWindow, SetConsoleCtrlHandler,
    ATTACH_PARENT_PROCESS, CTRL_BREAK_EVENT,
};

pub const FINISHED_EVENT: &str = "svn-update-finished";
const POLL_INTERVAL: Duration = Duration::from_millis(80);
const GRACEFUL_CANCEL_TIMEOUT: Duration = Duration::from_secs(3);

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

#[derive(Clone, Default)]
pub struct SvnUpdateManager {
    inner: Arc<Mutex<UpdateState>>,
}

#[derive(Default)]
struct UpdateState {
    next_id: u64,
    running: Option<RunningUpdate>,
}

struct RunningUpdate {
    update_id: u64,
    pid: u32,
    directories: Vec<String>,
    cancel_requested: bool,
    control: Sender<UpdateControl>,
}

enum UpdateControl {
    Cancel,
}

enum ProcessCompletion {
    Exited(ExitStatus),
    WaitFailed(String),
}

pub fn status(manager: &SvnUpdateManager) -> Result<SvnUpdateStatus, String> {
    let state = manager
        .inner
        .lock()
        .map_err(|_| "SVN Update 状态锁已损坏。".to_owned())?;
    Ok(status_from_state(&state))
}

pub fn start(
    app: AppHandle,
    manager: &SvnUpdateManager,
    directories: &[String],
    wc_root: &str,
) -> Result<SvnUpdateStatus, String> {
    if directories.is_empty() {
        return Err("请至少指定一个 SVN Update 目录。".to_owned());
    }
    let mut scopes = Vec::new();
    for directory in directories {
        let (scope, declared_root) = path_scope::validate_scope(directory, wc_root)?;
        if !scope.is_dir() {
            return Err(format!("当前 Update 目录不存在：{}", scope.display()));
        }
        let actual_root = svn::working_copy_root(&scope)?;
        if path_scope::path_key(&actual_root) != path_scope::path_key(&declared_root) {
            return Err("当前目录的实际 SVN 工作副本根目录与扫描结果不一致，请先刷新。".to_owned());
        }
        if !scopes.iter().any(|existing: &std::path::PathBuf| {
            path_scope::path_key(existing) == path_scope::path_key(&scope)
        }) {
            scopes.push(scope);
        }
    }
    let executable = svn::executable_path()?;

    let mut state = manager
        .inner
        .lock()
        .map_err(|_| "SVN Update 状态锁已损坏。".to_owned())?;
    if let Some(running) = &state.running {
        return Err(format!(
            "已有 SVN Update 正在运行：{}（PID {}）",
            running.directories.join("；"),
            running.pid
        ));
    }

    let mut command = update_command(&executable, &scopes);
    configure_visible_console(&mut command);
    let child = command.spawn().map_err(|error| {
        format!(
            "无法启动可见 SVN Update 控制台 {}：{error}",
            executable.display()
        )
    })?;

    state.next_id = state.next_id.wrapping_add(1).max(1);
    let update_id = state.next_id;
    let pid = child.id();
    let directories: Vec<String> = scopes
        .iter()
        .map(|scope| scope.to_string_lossy().into_owned())
        .collect();
    let (control, receiver) = mpsc::channel();
    state.running = Some(RunningUpdate {
        update_id,
        pid,
        directories: directories.clone(),
        cancel_requested: false,
        control,
    });
    let launched = status_from_state(&state);
    drop(state);

    let monitor_manager = manager.clone();
    thread::spawn(move || {
        monitor_process(
            app,
            monitor_manager,
            child,
            receiver,
            update_id,
            pid,
            directories,
        );
    });

    Ok(launched)
}

pub fn cancel(manager: &SvnUpdateManager, update_id: u64) -> Result<SvnUpdateStatus, String> {
    let mut state = manager
        .inner
        .lock()
        .map_err(|_| "SVN Update 状态锁已损坏。".to_owned())?;
    let running = state
        .running
        .as_mut()
        .ok_or_else(|| "当前没有正在运行的 SVN Update。".to_owned())?;
    if running.update_id != update_id {
        return Err("Update 已经结束或已被新的任务替代。".to_owned());
    }
    if !running.cancel_requested {
        running
            .control
            .send(UpdateControl::Cancel)
            .map_err(|_| "SVN Update 已经结束，无法再发送取消请求。".to_owned())?;
        running.cancel_requested = true;
    }
    Ok(status_from_state(&state))
}

fn monitor_process(
    app: AppHandle,
    manager: SvnUpdateManager,
    child: Child,
    receiver: Receiver<UpdateControl>,
    update_id: u64,
    pid: u32,
    directories: Vec<String>,
) {
    let (mut cancel_requested, forced, completion) = wait_for_process(child, receiver, pid);
    let state_cancel_requested = clear_running_update(&manager, update_id);
    cancel_requested |= state_cancel_requested;
    let event = finished_event(update_id, directories, cancel_requested, forced, completion);
    let _ = app.emit(FINISHED_EVENT, event);
}

fn wait_for_process(
    mut child: Child,
    receiver: Receiver<UpdateControl>,
    pid: u32,
) -> (bool, bool, ProcessCompletion) {
    let mut cancel_requested = false;
    let mut cancel_deadline = None;
    let mut forced = false;

    let completion = loop {
        match child.try_wait() {
            Ok(Some(exit_status)) => break ProcessCompletion::Exited(exit_status),
            Ok(None) => {}
            Err(error) => {
                break ProcessCompletion::WaitFailed(format!(
                    "无法读取 SVN Update 进程状态：{error}"
                ));
            }
        }

        match receiver.try_recv() {
            Ok(UpdateControl::Cancel) if !cancel_requested => {
                cancel_requested = true;
                match request_graceful_cancel(pid) {
                    Ok(()) => cancel_deadline = Some(Instant::now() + GRACEFUL_CANCEL_TIMEOUT),
                    Err(_) => {
                        forced = true;
                        let _ = child.kill();
                    }
                }
            }
            Ok(UpdateControl::Cancel) | Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {}
        }

        if cancel_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            forced = true;
            cancel_deadline = None;
            let _ = child.kill();
        }
        thread::sleep(POLL_INTERVAL);
    };

    (cancel_requested, forced, completion)
}

fn clear_running_update(manager: &SvnUpdateManager, update_id: u64) -> bool {
    let Ok(mut state) = manager.inner.lock() else {
        return false;
    };
    if state
        .running
        .as_ref()
        .is_some_and(|running| running.update_id == update_id)
    {
        return state
            .running
            .take()
            .is_some_and(|running| running.cancel_requested);
    }
    false
}

fn status_from_state(state: &UpdateState) -> SvnUpdateStatus {
    match &state.running {
        Some(running) => SvnUpdateStatus {
            running: true,
            update_id: Some(running.update_id),
            pid: Some(running.pid),
            directories: running.directories.clone(),
            cancel_requested: running.cancel_requested,
        },
        None => SvnUpdateStatus {
            running: false,
            update_id: None,
            pid: None,
            directories: Vec::new(),
            cancel_requested: false,
        },
    }
}

fn finished_event(
    update_id: u64,
    directories: Vec<String>,
    cancel_requested: bool,
    forced: bool,
    completion: ProcessCompletion,
) -> SvnUpdateFinished {
    let (outcome, exit_code, message) = match completion {
        ProcessCompletion::Exited(status) if cancel_requested => {
            let message = if forced {
                "SVN Update 已强制取消；如果后续提示工作副本锁定，请执行 SVN cleanup。"
            } else {
                "SVN Update 已取消。"
            };
            ("cancelled", status.code(), message.to_owned())
        }
        ProcessCompletion::Exited(status) if status.success() => {
            ("success", status.code(), "SVN Update 已完成。".to_owned())
        }
        ProcessCompletion::Exited(status) => (
            "failed",
            status.code(),
            format!(
                "SVN Update 执行失败（退出码 {}），请查看刚才的控制台输出。",
                status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "未知".to_owned())
            ),
        ),
        ProcessCompletion::WaitFailed(error) => ("failed", None, error),
    };
    SvnUpdateFinished {
        update_id,
        directories,
        outcome: outcome.to_owned(),
        exit_code,
        forced,
        message,
    }
}

fn configure_visible_console(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP);
}

fn update_command(executable: &std::path::Path, scopes: &[std::path::PathBuf]) -> Command {
    let mut command = Command::new(executable);
    command.arg("update").arg("--");
    command.args(scopes.iter().map(|scope| svn::target_argument(scope)));
    if let Some(first_scope) = scopes.first() {
        command.current_dir(first_scope);
    }
    command
}

#[cfg(windows)]
fn request_graceful_cancel(pid: u32) -> Result<(), String> {
    // A non-console Tauri process must temporarily attach to the child's console
    // before it can address the new process group with Ctrl+Break.
    unsafe {
        let had_console = !GetConsoleWindow().is_null();
        if had_console && FreeConsole() == 0 {
            return Err("无法暂时分离当前控制台。".to_owned());
        }
        if AttachConsole(pid) == 0 {
            if had_console {
                let _ = AttachConsole(ATTACH_PARENT_PROCESS);
            }
            return Err("无法连接 SVN Update 控制台。".to_owned());
        }
        let _ = SetConsoleCtrlHandler(None, 1);
        let sent = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) != 0;
        let _ = FreeConsole();
        if had_console {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        }
        let _ = SetConsoleCtrlHandler(None, 0);
        if !sent {
            return Err("无法向 SVN Update 发送 Ctrl+Break。".to_owned());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn request_graceful_cancel(_pid: u32) -> Result<(), String> {
    Err("当前平台不支持控制台取消信号。".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::{ExitStatus, Stdio};

    #[cfg(windows)]
    use std::os::windows::process::ExitStatusExt;

    #[test]
    #[cfg(windows)]
    fn classifies_success_failure_and_cancelled_outcomes() {
        let success = finished_event(
            1,
            vec![r"F:\wc\src".to_owned()],
            false,
            false,
            ProcessCompletion::Exited(ExitStatus::from_raw(0)),
        );
        assert_eq!(success.outcome, "success");

        let failed = finished_event(
            2,
            vec![r"F:\wc\src".to_owned()],
            false,
            false,
            ProcessCompletion::Exited(ExitStatus::from_raw(1)),
        );
        assert_eq!(failed.outcome, "failed");

        let cancelled = finished_event(
            3,
            vec![r"F:\wc\src".to_owned()],
            true,
            true,
            ProcessCompletion::Exited(ExitStatus::from_raw(1)),
        );
        assert_eq!(cancelled.outcome, "cancelled");
        assert!(cancelled.forced);
    }

    #[test]
    #[cfg(windows)]
    fn cancellation_channel_stops_the_exact_child_process() {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
        let child = command.spawn().unwrap();
        let pid = child.id();
        let (sender, receiver) = mpsc::channel();
        sender.send(UpdateControl::Cancel).unwrap();

        let started = Instant::now();
        let (cancel_requested, forced, completion) = wait_for_process(child, receiver, pid);
        assert!(cancel_requested);
        assert!(forced);
        assert!(matches!(completion, ProcessCompletion::Exited(_)));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    #[cfg(windows)]
    fn real_update_stays_below_the_selected_directory() {
        if Command::new("svnadmin.exe")
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
        let first_copy = temporary.path().join("working-one");
        let second_copy = temporary.path().join("working-two");
        run_checked(Command::new("svnadmin.exe").arg("create").arg(&repository));
        let repository_url = format!(
            "file:///{}",
            repository.to_string_lossy().replace('\\', "/")
        );
        let trunk_url = format!("{repository_url}/trunk");
        run_checked(
            Command::new("svn.exe")
                .arg("mkdir")
                .arg(&trunk_url)
                .args(["-m", "create trunk"]),
        );
        run_checked(
            Command::new("svn.exe")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&first_copy),
        );
        run_checked(
            Command::new("svn.exe")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&second_copy),
        );

        fs::create_dir_all(second_copy.join("src")).unwrap();
        fs::write(second_copy.join("parent.txt"), "parent-one\n").unwrap();
        fs::write(second_copy.join("src").join("child.txt"), "child-one\n").unwrap();
        run_checked(
            Command::new("svn.exe")
                .args(["add", "--force"])
                .arg(&second_copy),
        );
        run_checked(
            Command::new("svn.exe")
                .arg("commit")
                .arg(&second_copy)
                .args(["-m", "initial files"]),
        );
        run_checked(Command::new("svn.exe").arg("update").arg(&first_copy));

        fs::write(second_copy.join("parent.txt"), "parent-two\n").unwrap();
        fs::write(second_copy.join("src").join("child.txt"), "child-two\n").unwrap();
        run_checked(
            Command::new("svn.exe")
                .arg("commit")
                .arg(&second_copy)
                .args(["-m", "remote updates"]),
        );

        let executable = svn::executable_path().unwrap();
        let output = update_command(&executable, &[first_copy.join("src")])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            fs::read_to_string(first_copy.join("src").join("child.txt")).unwrap(),
            "child-two\n"
        );
        assert_eq!(
            fs::read_to_string(first_copy.join("parent.txt")).unwrap(),
            "parent-one\n"
        );
    }

    #[cfg(windows)]
    fn run_checked(command: &mut Command) {
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
