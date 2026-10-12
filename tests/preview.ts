// Browser-only UI fixture: does not read or write the user's working copy
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
const directory = "C:\\fixture";
let modified = "class Player\r\n{\r\n    int health = 200;\r\n}\r\n";
const original = modified.replace("200", "100");
let revision = 1;
const changes = [
  { path: directory + "\\src\\Player.cs", relativePath: "src/Player.cs", name: "Player.cs", item: "modified", statusCode: "M", properties: "none", isDirectory: false, treeConflicted: false, baseRevision: "1" },
  { path: directory + "\\src\\New.cs", relativePath: "src/New.cs", name: "New.cs", item: "unversioned", statusCode: "?", properties: "none", isDirectory: false, treeConflicted: false, baseRevision: null },
];
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
  if (command === "scan_changed_paths") return { roots: [directory], changes };
  if (command === "get_file_fingerprint") return { exists: true, isDirectory: false, size: modified.length, modifiedNanos: String(revision) };
  if (command === "get_file_diff") return { path: args.path, original: args.isDirectory ? "" : original, modified: args.isDirectory ? "" : modified, originalLabel: "BASE · r1", modifiedLabel: "工作副本", originalEncoding: "UTF-8", modifiedEncoding: "UTF-8", originalBytes: original.length, modifiedBytes: modified.length, isBinary: false, isDirectory: args.isDirectory, truncated: false, note: null };
  if (command === "save_working_file_content") { if (args.expectedContent !== modified) throw new Error("文件已在外部修改"); modified = args.content; revision++; return { exists: true, isDirectory: false, size: modified.length, modifiedNanos: String(revision) }; }
  if (command === "start_working_copy_watcher") return { watcherId: 1, directories: [directory] };
  if (command === "check_client_update") return { currentVersion: "0.4.1", version: "0.5.0", available: true };
  if (command === "download_client_update") return null;
  if (command === "get_svn_update_status") return { running: false, updateId: null, pid: null, directories: [], cancelRequested: false };
  if (command.includes("availability")) return { available: false, path: null, autoSelectFiles: true, showUnversioned: true };
  if (command === "plugin:event|listen") return 1;
  return null;
});
await import("../src/main");
