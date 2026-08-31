import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/diffPalette.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { effectiveDiffPalette, monacoThemeForPalette } = await import(moduleUrl);

test("uses a distinct palette for whole-file additions by default", () => {
  assert.equal(effectiveDiffPalette("status", { item: "added" }), "new");
  assert.equal(effectiveDiffPalette("status", { item: "unversioned" }), "new");
  assert.equal(effectiveDiffPalette("status", { item: "modified" }), "classic");
});

test("maps explicit palettes to stable Monaco themes", () => {
  assert.equal(monacoThemeForPalette("new"), "svn-scope-new-file");
  assert.equal(monacoThemeForPalette("contrast"), "svn-scope-high-contrast");
  assert.equal(monacoThemeForPalette("classic"), "svn-scope-light");
});
