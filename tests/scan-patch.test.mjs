import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/scanPatch.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { changePathIsWithin, mergeScanPatch, patchTouchesPath } = await import(moduleUrl);

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
