import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/actionSelection.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { actionPathKey, updateActionSelection } = await import(moduleUrl);

function change(name) {
  return { path: `F:\\wc\\${name}`, name, relativePath: name };
}

test("plain, toggle, and range selection stay independent", () => {
  const changes = [change("a.cs"), change("b.cs"), change("c.cs"), change("d.cs")];
  const plain = updateActionSelection(new Set(), changes[1], changes, undefined, {
    toggle: false,
    range: false,
  });
  assert.deepEqual([...plain.selectedPaths], [actionPathKey(changes[1].path)]);

  const toggled = updateActionSelection(plain.selectedPaths, changes[3], changes, plain.anchorPath, {
    toggle: true,
    range: false,
  });
  assert.deepEqual([...toggled.selectedPaths], [
    actionPathKey(changes[1].path),
    actionPathKey(changes[3].path),
  ]);

  const ranged = updateActionSelection(toggled.selectedPaths, changes[2], changes, plain.anchorPath, {
    toggle: false,
    range: true,
  });
  assert.deepEqual([...ranged.selectedPaths], [
    actionPathKey(changes[1].path),
    actionPathKey(changes[2].path),
  ]);
});
