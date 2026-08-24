import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/diffCache.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code: compiled } = await transformWithOxc(source, sourcePath);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { DiffCache } = await import(moduleUrl);

function change(path, baseRevision = "7") {
  return {
    path,
    relativePath: path,
    name: path,
    item: "modified",
    properties: "none",
    statusCode: "M",
    isDirectory: false,
    treeConflicted: false,
    baseRevision,
  };
}

function fingerprint(size, modifiedNs) {
  return {
    exists: true,
    isDirectory: false,
    size,
    modifiedNs,
  };
}

function result(path) {
  return {
    path,
    original: "before",
    modified: "after",
    originalLabel: "BASE",
    modifiedLabel: "工作副本",
    originalEncoding: "UTF-8",
    modifiedEncoding: "UTF-8",
    originalBytes: 6,
    modifiedBytes: 5,
    isBinary: false,
    isDirectory: false,
    truncated: false,
    note: null,
  };
}

test("reuses a cached diff only while the file fingerprint is unchanged", () => {
  const cache = new DiffCache(12);
  const entry = change("F:\\wc\\main.ts");
  const initialFingerprint = fingerprint(5, "100");
  const cachedResult = result(entry.path);

  cache.put(entry, initialFingerprint, cachedResult);

  assert.equal(cache.get(entry, initialFingerprint), cachedResult);
  assert.equal(cache.get(entry, fingerprint(6, "200")), undefined);
});

test("invalidates cached content when the SVN BASE revision changes", () => {
  const cache = new DiffCache(12);
  const entry = change("F:\\wc\\main.ts", "7");
  const currentFingerprint = fingerprint(5, "100");

  cache.put(entry, currentFingerprint, result(entry.path));

  assert.equal(cache.get(change(entry.path, "8"), currentFingerprint), undefined);
});

test("evicts the least recently used entry at the configured limit", () => {
  const cache = new DiffCache(2);
  const currentFingerprint = fingerprint(5, "100");
  const first = change("F:\\wc\\first.ts");
  const second = change("F:\\wc\\second.ts");
  const third = change("F:\\wc\\third.ts");

  cache.put(first, currentFingerprint, result(first.path));
  cache.put(second, currentFingerprint, result(second.path));
  assert.ok(cache.get(first, currentFingerprint));
  cache.put(third, currentFingerprint, result(third.path));

  assert.equal(cache.get(second, currentFingerprint), undefined);
  assert.ok(cache.get(first, currentFingerprint));
  assert.ok(cache.get(third, currentFingerprint));
});

test("can expand its capacity for an explicit bulk refresh", () => {
  const cache = new DiffCache(1);
  const currentFingerprint = fingerprint(5, "100");
  const first = change("F:\\wc\\first.ts");
  const second = change("F:\\wc\\second.ts");

  cache.setLimit(2);
  cache.put(first, currentFingerprint, result(first.path));
  cache.put(second, currentFingerprint, result(second.path));

  assert.ok(cache.get(first, currentFingerprint));
  assert.ok(cache.get(second, currentFingerprint));
});
