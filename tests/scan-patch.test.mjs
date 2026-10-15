import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/scanPatch.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  changePathIsWithin,
  mergeScanPatch,
  patchTouchesPath,
  refreshTargetsForDirectory,
  refreshPathsForChanges,
  relativeChangePath,
  ScanPatchTracker,
} = await import(moduleUrl);

function change(path, relativePath, item = "modified") {
  return {
    path,
    relativePath,
    name: relativePath.split("/").at(-1),
    item,
    properties: "none",
    statusCode: item === "unversioned" ? "?" : "M",
    isDirectory: false,
    treeConflicted: false,
    baseRevision: "1",
  };
}

test("后台目录晚返回时保留新文件与已提交文件的定点刷新", () => {
  const tracker = new ScanPatchTracker();
  const directory = tracker.begin();
  const file = tracker.begin();
  const newFile = change("F:\\wc\\new.cs", "new.cs");
  const fresh = tracker.finish(file, { roots: ["F:\\wc\\new.cs", "F:\\wc\\committed.cs"], changes: [newFile] });
  assert.deepEqual(fresh.changes, [newFile]);
  const late = tracker.finish(directory, { roots: ["F:\\wc"], changes: [change("F:\\wc\\committed.cs", "committed.cs")] });
  assert.deepEqual(late.changes, [newFile]);
});

test("交错返回按请求新旧合并，不把范围外文件并入旧补丁", () => {
  const tracker = new ScanPatchTracker();
  const older = tracker.begin();
  const newer = tracker.begin();
  const newest = tracker.begin();
  tracker.finish(newest, { roots: ["F:\\wc\\a.cs"], changes: [] });
  tracker.finish(newer, { roots: ["F:\\wc"], changes: [change("F:\\wc\\a.cs", "a.cs"), change("F:\\wc\\b.cs", "b.cs")] });
  const result = tracker.finish(older, { roots: ["F:\\wc\\a.cs"], changes: [change("F:\\wc\\a.cs", "a.cs")] });
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.roots, ["F:\\wc\\a.cs"]);
});

test("切换范围和失败任务不留下待合并结果", () => {
  const tracker = new ScanPatchTracker();
  const old = tracker.begin();
  tracker.clear();
  assert.equal(tracker.finish(old, { roots: ["F:\\wc"], changes: [] }), undefined);
  const failed = tracker.begin();
  tracker.cancel(failed);
  assert.equal(tracker.finish(failed, { roots: ["F:\\wc"], changes: [] }), undefined);
});

test("matches Windows path boundaries without matching sibling prefixes", () => {
  assert.equal(changePathIsWithin("F:\\wc\\src\\a.cs", "F:\\wc\\src"), true);
  assert.equal(changePathIsWithin("F:\\wc\\src-old\\a.cs", "F:\\wc\\src"), false);
});

test("replaces only the refreshed subtree and keeps unrelated changes", () => {
  const current = [
    change("F:\\wc\\src\\a.cs", "src/a.cs"),
    change("F:\\wc\\src\\nested\\old.cs", "src/nested/old.cs"),
    change("F:\\wc\\tools\\keep.cs", "tools/keep.cs"),
  ];
  const patch = {
    roots: ["F:\\wc\\src\\nested"],
    changes: [change("F:\\wc\\src\\nested\\new.cs", "src/nested/new.cs", "unversioned")],
  };
  const result = mergeScanPatch(current, patch);
  assert.deepEqual(
    result.map((entry) => entry.relativePath),
    ["src/a.cs", "src/nested/new.cs", "tools/keep.cs"],
  );
  assert.equal(patchTouchesPath(patch, "F:\\wc\\src\\nested\\old.cs"), true);
  assert.equal(patchTouchesPath(patch, "F:\\wc\\tools\\keep.cs"), false);
});

test("chooses safe refresh targets for real and grouping directories", () => {
  const scopes = ["F:\\wc\\feature-a\\src", "F:\\wc\\feature-b\\src"];
  assert.deepEqual(
    refreshTargetsForDirectory("F:\\wc\\feature-a\\src\\nested", scopes),
    ["F:\\wc\\feature-a\\src\\nested"],
  );
  assert.deepEqual(
    refreshTargetsForDirectory("F:\\wc\\feature-a", scopes),
    ["F:\\wc\\feature-a\\src"],
  );
  assert.deepEqual(refreshTargetsForDirectory("F:\\wc", scopes), scopes);
  assert.equal(relativeChangePath("F:\\wc\\feature-a\\src", "f:/wc"), "feature-a/src");
});


test("提交新目录中的文件后同时刷新原未版本化父目录", () => {
  const directory = { ...change("F:/wc/new", "new", "unversioned"), isDirectory: true };
  const nested = { ...change("F:/wc/new/nested", "new/nested", "unversioned"), isDirectory: true };
  const child = change("F:/wc/new/nested/added.cs", "new/nested/added.cs", "unversioned");
  const unrelated = change("F:/wc/keep.cs", "keep.cs");
  const current = [directory, nested, child, unrelated];
  const roots = refreshPathsForChanges([child.path], current);
  assert.deepEqual(roots, [directory.path]);
  assert.deepEqual(mergeScanPatch(current, { roots, changes: [] }), [unrelated]);
});

test("已提交文件的空状态补丁移除旧条目但保留其他修改", () => {
  const committed = change("F:/wc/src/submitted.cs", "src/submitted.cs");
  const remaining = change("F:/wc/src/keep.cs", "src/keep.cs");
  assert.deepEqual(mergeScanPatch([committed, remaining], {
    roots: refreshPathsForChanges([committed.path], [committed, remaining]), changes: [],
  }), [remaining]);
});
