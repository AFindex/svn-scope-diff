import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/sidebarResize.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  sidebarMaxWidth,
  sidebarWidthFromKey,
} = await import(moduleUrl);

test("clamps the sidebar while preserving enough diff width", () => {
  assert.equal(clampSidebarWidth(100, 1420), MIN_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(999, 1420), MAX_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(999, 960), 530);
  assert.equal(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, 960), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(sidebarMaxWidth(600), MIN_SIDEBAR_WIDTH);
});

test("supports accessible keyboard resizing", () => {
  assert.equal(sidebarWidthFromKey(348, "ArrowLeft", false, 1420), 330);
  assert.equal(sidebarWidthFromKey(348, "ArrowRight", true, 1420), 402);
  assert.equal(sidebarWidthFromKey(348, "Home", false, 1420), MIN_SIDEBAR_WIDTH);
  assert.equal(sidebarWidthFromKey(348, "End", false, 960), 530);
  assert.equal(sidebarWidthFromKey(348, "Enter", false, 1420), undefined);
});
