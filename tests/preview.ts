// Browser-only UI fixture: does not read or write the user's working copy
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
const directory = "C:\\fixture";
let modified = "class Player\r\n{\r\n    int health = 200;\r\n}\r\n";
let original = modified.replace("200", "100");
let revision = 1;
let changes = [
  { path: directory + "\\src\\Player.cs", relativePath: "src/Player.cs", name: "Player.cs", item: "modified", statusCode: "M", properties: "none", isDirectory: false, treeConflicted: false, baseRevision: "1" },
  { path: directory + "\\src\\New.cs", relativePath: "src/New.cs", name: "New.cs", item: "unversioned", statusCode: "?", properties: "none", isDirectory: false, treeConflicted: false, baseRevision: null },
];
const commitPreview = new URLSearchParams(location.search).has("commit");
if (commitPreview) {
  changes.push({ ...changes[1], path: directory + "\\new-folder", relativePath: "new-folder", name: "new-folder", isDirectory: true });
  const button = document.createElement("button");
  button.textContent = "模拟提交完成（文件时间戳不变）";
  button.style.cssText = "position:fixed;right:20px;bottom:30px;z-index:9999";
  button.onclick = () => {
    changes = changes.filter((change) => change.name !== "Player.cs");
    original = modified;
    button.textContent = "提交已模拟，请点击更新全部文本 Diff";
  };
  document.body.append(button);
}
const scan = () => ({ directory, scopeDirectories: [directory], wcRoot: directory, revision: "1", svnVersion: "1.14.5", changes });
mockWindows("main");
const previewMode = new URLSearchParams(location.search).get("history");
mockIPC(async (command, args: any) => {
  if (command === "get_launch_directory") return directory;
  if (command === "read_scan_history") return previewMode ? { savedAt: Date.now() - 3600000, scan: scan() } : null;
  if (command === "scan_changes") {
    if (previewMode) await new Promise((resolve) => setTimeout(resolve, 15000));
    if (previewMode === "fail") throw new Error("模拟 SVN 扫描失败");
    return { ...scan(), changes: previewMode ? changes.slice(0, 1) : changes };
  }
  if (command === "scan_changed_paths") return {
    roots: args.paths,
    changes: changes.filter((change) => args.paths.some((path: string) => change.path === path || change.path.startsWith(path + "\\"))),
  };
  if (command === "get_file_fingerprint") return { exists: true, isDirectory: false, size: modified.length, modifiedNs: String(revision) };
  if (command === "get_file_diff") return { path: args.path, original: args.isDirectory ? "" : original, modified: args.isDirectory ? "" : modified, originalLabel: "BASE · r1", modifiedLabel: "工作副本", originalEncoding: "UTF-8", modifiedEncoding: "UTF-8", originalBytes: original.length, modifiedBytes: modified.length, isBinary: false, isDirectory: args.isDirectory, truncated: false, note: null };
  if (command === "save_working_file_content") { if (args.expectedContent !== modified) throw new Error("文件已在外部修改"); modified = args.content; revision++; return { exists: true, isDirectory: false, size: modified.length, modifiedNs: String(revision) }; }
  if (command === "start_working_copy_watcher") return { watcherId: 1, directories: [directory] };
  if (command === "check_client_update") return { currentVersion: "0.4.2", version: "0.5.0", available: true };
  if (command === "download_client_update") return null;
  if (command === "open_tortoise_svn_commit") return { operationId: 1, selectedCount: args.paths.length, message: `测试提交目标：${args.paths.join("，")}` };
  if (command === "get_svn_update_status") return { running: false, updateId: null, pid: null, directories: [], cancelRequested: false };
  if (command.includes("availability")) return { available: commitPreview, path: null, autoSelectFiles: true, showUnversioned: true };
  if (command === "plugin:event|listen") return 1;
  return null;
});
await import("../src/main");
