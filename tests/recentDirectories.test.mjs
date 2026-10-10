import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transformWithOxc } from "vite";
const source = await readFile(new URL("../src/recentDirectories.ts", import.meta.url), "utf8");
const { code } = await transformWithOxc(source, "recentDirectories.ts");
const { rememberDirectories, readRecentDirectories, saveRecentDirectories } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
test("recent directories deduplicate Windows spelling, move newest first and cap history", () => {
  assert.deepEqual(rememberDirectories(["C:/WC/src", "D:/Other"], ["c:/wc/src/"]), ["c:/wc/src/", "D:/Other"]);
  assert.equal(rememberDirectories([], Array.from({ length: 20 }, (_, i) => `C:/wc/${i}`)).length, 12);
});
test("history survives storage round trips and malformed or unavailable storage", () => {
  let stored;
  globalThis.localStorage = { getItem: () => stored, setItem: (_, content) => { stored = content; } };
  saveRecentDirectories(["C:/wc"]);
  assert.deepEqual(readRecentDirectories(), ["C:/wc"]);
  stored = "invalid";
  assert.deepEqual(readRecentDirectories(), []);
  stored = '[null,42,"D:/wc"]';
  assert.deepEqual(readRecentDirectories(), ["D:/wc"]);
  globalThis.localStorage = { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("disabled"); } };
  assert.deepEqual(readRecentDirectories(), []);
  assert.doesNotThrow(() => saveRecentDirectories([]));
});
