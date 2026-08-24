import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/textDiffFiles.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { isTextDiffChange, textDiffChanges } = await import(moduleUrl);

function change(path, isDirectory = false) {
  return {
    path,
    relativePath: path,
    name: path,
    item: "modified",
    properties: "none",
    statusCode: "M",
    isDirectory,
    treeConflicted: false,
    baseRevision: "7",
  };
}

test("accepts common code-text extensions case-insensitively", () => {
  for (const path of ["main.py", "Vehicle.CS", "build.bat", "app.tsx", "config.yaml"]) {
    assert.equal(isTextDiffChange(change(path)), true, path);
  }
});

test("rejects directories, unknown extensions, and extensionless files", () => {
  assert.equal(isTextDiffChange(change("generated.py", true)), false);
  assert.equal(isTextDiffChange(change("image.png")), false);
  assert.equal(isTextDiffChange(change("notes.txt")), false);
  assert.equal(isTextDiffChange(change("Dockerfile")), false);
});

test("filters a mixed SVN change list without changing its order", () => {
  const changes = [change("a.py"), change("b.png"), change("c.cs")];
  assert.deepEqual(textDiffChanges(changes), [changes[0], changes[2]]);
});
