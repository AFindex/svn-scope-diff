import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
interface UpdateInfo { version: string; currentVersion: string; available: boolean; }
export function ClientUpdate({ disabled }: { disabled: boolean }) {
  const [update, setUpdate] = useState<UpdateInfo>();
  const [message, setMessage] = useState("启动时自动检查新版");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const runningRef = useRef(false);
  const check = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      const result = await invoke<UpdateInfo>("check_client_update");
      setUpdate(result);
      setReady(false);
      setMessage(result.available ? `发现新版本 ${result.version}` : `当前已是最新版本 ${result.currentVersion}`);
    } catch (error) { setMessage(`检查更新失败：${String(error)}`); }
    finally { runningRef.current = false; setBusy(false); }
  };
  useEffect(() => { void check(); }, []);
  const download = async () => {
    if (!update || runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setMessage("正在下载并校验更新包…");
    try {
      await invoke("download_client_update", { version: update.version });
      setReady(true);
      setMessage("下载及 SHA-256 校验完成，重启后安装；旧程序保留为 .backup");
    } catch (error) { setMessage(`下载失败：${String(error)}`); }
    finally { runningRef.current = false; setBusy(false); }
  };
  const install = async () => {
    if (disabled || busy || !ready) return;
    setBusy(true);
    try { await invoke("install_client_update"); }
    catch (error) { setMessage(`更新失败：${String(error)}`); setBusy(false); }
  };
  return <div className="client-update">
    <button type="button" className="toolbar-button" aria-expanded={open} onClick={() => setOpen(!open)}>{update?.available ? `新版 ${update.version}` : "客户端更新"}</button>
    {open && <div className="client-update-panel">
      <strong>SVN Scope 客户端更新</strong><p role="status">{message}</p>
      <button type="button" disabled={busy} onClick={() => void check()}>检查更新</button>{" "}
      {update?.available && !ready && <button type="button" disabled={busy} onClick={() => void download()}>下载更新</button>}
      {ready && <button type="button" disabled={busy || disabled} onClick={() => void install()}>重启并更新</button>}
      {ready && disabled && <p>请先保存编辑并等待当前操作结束。</p>}
    </div>}
  </div>;
}
