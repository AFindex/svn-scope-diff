import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/commitSelection.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  ancestorDirectorySelectionKeys,
  commitPathKey,
  expandCommitSelectionKeys,
  isCommitPathWithin,
  isCommitSelectable,
  reconcileCommitSelection,
  selectedCommitChanges,
} = await import(moduleUrl);

function change(path, item = "modified", isDirectory = false) {
  return {
    path,
    relativePath: path,
    name: path.split(/[\\/]/).at(-1),
    item,
    properties: "none",
    statusCode: "M",
    isDirectory,
    treeConflicted: false,
    baseRevision: "7",
  };
}

test("normalizes Windows commit paths and respects directory boundaries", () => {
  assert.equal(commitPathKey("F:/WC/Src/"), "f:\\wc\\src");
  assert.equal(isCommitPathWithin("F:\\wc\\src\\main.cs", "f:/WC/src"), true);
  assert.equal(isCommitPathWithin("F:\\wc\\src-old\\main.cs", "F:\\wc\\src"), false);
});

test("expands a selected directory to its changed descendants", () => {
  const directory = change("F:\\wc\\src", "modified", true);
  const child = change("F:\\wc\\src\\main.cs");
  const sibling = change("F:\\wc\\tests\\main.cs");
  const expanded = expandCommitSelectionKeys([directory, child, sibling], [directory]);

  assert.deepEqual([...expanded].sort(), [
    commitPathKey(directory.path),
    commitPathKey(child.path),
  ].sort());
});

test("does not allow an unversioned directory to be forwarded recursively", () => {
  const directory = change("F:\\wc\\generated", "unversioned", true);
  assert.equal(isCommitSelectable(directory), false);
  assert.equal(expandCommitSelectionKeys([directory], [directory]).size, 0);
});

test("reconciles stale selections after refresh and returns selected entries", () => {
  const retained = change("F:\\wc\\src\\main.cs");
  const cleaned = change("F:\\wc\\src\\clean.cs");
  const selected = new Set([commitPathKey(retained.path), commitPathKey(cleaned.path)]);
  const reconciled = reconcileCommitSelection(selected, [retained]);

  assert.deepEqual([...reconciled], [commitPathKey(retained.path)]);
  assert.deepEqual(selectedCommitChanges([retained], reconciled), [retained]);
});

test("a selected directory adopts new descendants after a refresh", () => {
  const directory = change("F:\\wc\\src", "modified", true);
  const newChild = change("F:\\wc\\src\\new.cs");
  const reconciled = reconcileCommitSelection(
    new Set([commitPathKey(directory.path)]),
    [directory, newChild],
  );

  assert.equal(reconciled.has(commitPathKey(directory.path)), true);
  assert.equal(reconciled.has(commitPathKey(newChild.path)), true);
});

test("unchecking a descendant identifies broad directory targets to remove", () => {
  const directory = change("F:\\wc\\src", "modified", true);
  const child = change("F:\\wc\\src\\main.cs");
  const siblingDirectory = change("F:\\wc\\tests", "modified", true);
  const ancestors = ancestorDirectorySelectionKeys(
    [directory, child, siblingDirectory],
    [child],
  );

  assert.deepEqual([...ancestors], [commitPathKey(directory.path)]);
});
