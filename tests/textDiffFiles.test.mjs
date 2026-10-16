import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/textDiffFiles.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { isTextDiffChange, textDiffChanges, normalizeTextDiffExtensions, readTextDiffExtensions, saveTextDiffExtensions, TEXT_DIFF_EXTENSIONS } = await import(moduleUrl);

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


test("自定义格式归一化、去重，空选择不恢复默认，目录不参与 Diff", () => {
  assert.deepEqual(normalizeTextDiffExtensions(".CS, *.asmdef； TXT .cs"), ["cs", "asmdef", "txt"]);
  const changes = [change("a.cs"), change("b.asmdef"), change("c.TXT"), change("folder.txt", true)];
  assert.deepEqual(textDiffChanges(changes, ["asmdef", ".txt"]), [changes[1], changes[2]]);
  assert.deepEqual(textDiffChanges(changes, []), []);
  assert.deepEqual(textDiffChanges(changes), [changes[0]]);
});

test("格式选择持久化，包括空选择；未配置或损坏时沿用默认白名单", () => {
  let stored = null;
  globalThis.window = { localStorage: { getItem: () => stored, setItem: (_, text) => { stored = text; } } };
  try {
    assert.deepEqual(readTextDiffExtensions(), [...TEXT_DIFF_EXTENSIONS]);
    saveTextDiffExtensions(["asmdef", "txt"]);
    assert.deepEqual(readTextDiffExtensions(), ["asmdef", "txt"]);
    saveTextDiffExtensions([]);
    assert.deepEqual(readTextDiffExtensions(), []);
    stored = "invalid json";
    assert.deepEqual(readTextDiffExtensions(), [...TEXT_DIFF_EXTENSIONS]);
  } finally { delete globalThis.window; }
});
