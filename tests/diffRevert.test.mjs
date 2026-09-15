import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/diffRevert.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { revertSelectedDiffChanges, selectedDiffChanges } = await import(moduleUrl);

test("reverts a replacement selected on the modified side", () => {
  const changes = [{
    originalStartLineNumber: 2,
    originalEndLineNumber: 2,
    modifiedStartLineNumber: 2,
    modifiedEndLineNumber: 2,
  }];
  const selection = { side: "modified", startLineNumber: 2, endLineNumber: 2 };
  assert.equal(
    revertSelectedDiffChanges("one\r\nbase\r\nthree", "one\r\nwork\r\nthree", changes, selection).content,
    "one\r\nbase\r\nthree",
  );
});

test("reverts inserted and deleted line hunks from either side", () => {
  const insertion = [{
    originalStartLineNumber: 1,
    originalEndLineNumber: 0,
    modifiedStartLineNumber: 2,
    modifiedEndLineNumber: 2,
  }];
  assert.equal(
    revertSelectedDiffChanges("one\nthree", "one\ntwo\nthree", insertion, {
      side: "modified",
      startLineNumber: 2,
      endLineNumber: 2,
    }).content,
    "one\nthree",
  );

  const deletion = [{
    originalStartLineNumber: 2,
    originalEndLineNumber: 2,
    modifiedStartLineNumber: 1,
    modifiedEndLineNumber: 0,
  }];
  const selection = { side: "original", startLineNumber: 2, endLineNumber: 2 };
  assert.equal(selectedDiffChanges(deletion, selection).length, 1);
  assert.equal(
    revertSelectedDiffChanges("one\ntwo\nthree", "one\nthree", deletion, selection).content,
    "one\ntwo\nthree",
  );
});
