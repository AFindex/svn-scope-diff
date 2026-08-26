import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/changeFilters.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  ALL_FILE_TYPES,
  DIRECTORY_FILE_TYPE,
  NO_EXTENSION_FILE_TYPE,
  directoryOf,
  extensionOf,
  fileTypeOptions,
  filterChanges,
} = await import(moduleUrl);

function change(relativePath, isDirectory = false) {
  const parts = relativePath.split(/[\\/]/);
  return {
    path: `F:\\wc\\${relativePath}`,
    relativePath,
    name: parts.at(-1),
    item: "modified",
    properties: "none",
    statusCode: "M",
    isDirectory,
    treeConflicted: false,
    baseRevision: "7",
  };
}

test("extracts normalized extensions and special directory types", () => {
  assert.equal(extensionOf(change("src\\Main.CS")), "cs");
  assert.equal(extensionOf(change("Dockerfile")), NO_EXTENSION_FILE_TYPE);
  assert.equal(extensionOf(change("generated.py", true)), DIRECTORY_FILE_TYPE);
  assert.equal(directoryOf(change("src\\nested/main.ts")), "src\\nested");
});

test("builds deterministic type options with counts", () => {
  const options = fileTypeOptions([
    change("src/a.cs"),
    change("src/b.CS"),
    change("src/c.py"),
    change("assets", true),
    change("Dockerfile"),
  ]);
  assert.deepEqual(options.map(({ value, count }) => [value, count]), [
    [DIRECTORY_FILE_TYPE, 1],
    ["cs", 2],
    ["py", 1],
    [NO_EXTENSION_FILE_TYPE, 1],
  ]);
});

test("filters by multiple text terms or multiple extensions", () => {
  const changes = [
    change("src\\VehicleController.cs"),
    change("tests\\VehicleTests.py"),
    change("README"),
  ];
  assert.deepEqual(filterChanges(changes, "text", "src vehicle", [ALL_FILE_TYPES]), [changes[0]]);
  assert.deepEqual(filterChanges(changes, "extension", "", ["cs", "py"]), changes.slice(0, 2));
  assert.deepEqual(filterChanges(changes, "extension", "", []), []);
  assert.deepEqual(filterChanges(changes, "extension", "", [ALL_FILE_TYPES]), changes);
});
