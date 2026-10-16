import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/changeItemActions.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  changeActionCapabilities,
  currentActionTargets,
  conflictLabel,
  countConflictBlocks,
  isConflictedChange,
} = await import(moduleUrl);

function change(overrides = {}) {
  return {
    path: "F:\\wc\\src\\main.cs",
    relativePath: "main.cs",
    name: "main.cs",
    item: "modified",
    properties: "none",
    statusCode: "M",
    isDirectory: false,
    treeConflicted: false,
    baseRevision: "18",
    ...overrides,
  };
}

test("describes combined text, property, and tree conflicts", () => {
  const target = change({
    item: "conflicted",
    properties: "conflicted",
    statusCode: "C",
    treeConflicted: true,
  });
  assert.equal(isConflictedChange(target), true);
  assert.equal(conflictLabel(target), "文本冲突 + 属性冲突 + 树冲突");
});

test("only enables actions that make sense for the selected SVN item", () => {
  const conflict = change({ item: "conflicted", statusCode: "C" });
  assert.deepEqual(changeActionCapabilities(conflict, true), {
    canOpen: true,
    canCommit: false,
    canRevert: true,
    canBlame: true,
    canShowLog: true,
    canConflictEditor: true,
    canResolve: true,
  });

  const unversionedDirectory = change({
    item: "unversioned",
    statusCode: "?",
    isDirectory: true,
    baseRevision: null,
  });
  assert.deepEqual(changeActionCapabilities(unversionedDirectory, true), {
    canOpen: true,
    canCommit: true,
    canRevert: false,
    canBlame: false,
    canShowLog: false,
    canConflictEditor: false,
    canResolve: false,
  });

  const virtualFolder = change({ contextOnly: true, isDirectory: true, item: "normal" });
  assert.deepEqual(changeActionCapabilities(virtualFolder, true), {
    canOpen: true,
    canCommit: false,
    canRevert: false,
    canBlame: false,
    canShowLog: true,
    canConflictEditor: false,
    canResolve: false,
  });
});

test("counts text conflict blocks from working-copy markers", () => {
  const content = [
    "<<<<<<< .mine",
    "local",
    "=======",
    "incoming",
    ">>>>>>> .r18",
    "<<<<<<< .mine",
  ].join("\n");
  assert.equal(countConflictBlocks(content), 2);
  assert.equal(countConflictBlocks("const marker = '<<<<<<<';"), 0);
});


test("操作使用核对后的状态，移除干净项及不再满足条件的目标", () => {
  const edited = change();
  const missing = edited.path + ".clean";
  const unversioned = change({ path: edited.path + ".new", item: "unversioned", baseRevision: null });
  const conflict = change({ path: edited.path + ".conflict", item: "conflicted" });
  const paths = [edited.path.toUpperCase(), missing, unversioned.path, conflict.path];
  const latest = [edited, unversioned, conflict];
  assert.deepEqual(currentActionTargets("revert", paths, latest), [edited, conflict]);
  assert.deepEqual(currentActionTargets("commit", paths, latest), [edited, unversioned]);
  assert.deepEqual(currentActionTargets("resolve", paths, latest), [conflict]);
  assert.deepEqual(currentActionTargets("revert", [missing], latest), []);
});
