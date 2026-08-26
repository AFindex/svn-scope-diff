import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/diffSearch.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { wrapSearchMatchIndex } = await import(moduleUrl);

test("wraps side-search navigation in both directions", () => {
  assert.equal(wrapSearchMatchIndex(0, 3), 0);
  assert.equal(wrapSearchMatchIndex(3, 3), 0);
  assert.equal(wrapSearchMatchIndex(-1, 3), 2);
  assert.equal(wrapSearchMatchIndex(2, 0), -1);
});
