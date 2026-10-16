import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/scanRefreshQueue.ts", import.meta.url));
const { code } = await transformWithOxc(await readFile(sourcePath, "utf8"), sourcePath);
const { ScanRefreshQueue } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("连续两个显式刷新都能返回，不互相丢弃不同文件的结果", async () => {
  const queue = new ScanRefreshQueue();
  const gate = deferred();
  const applied = [];
  const first = queue.run(async (isCurrent) => { await gate.promise; if (isCurrent()) applied.push("a"); }, true);
  await queue.run(async (isCurrent) => { if (isCurrent()) applied.push("b"); }, true);
  gate.resolve();
  await first;
  assert.deepEqual(applied, ["b", "a"]);
});

test("提交刷新越过慢扫描，旧结果不能恢复已提交文件", async () => {
  const queue = new ScanRefreshQueue();
  const slow = deferred();
  let changes = ["committed.cs"];
  const automatic = queue.run(async (isCurrent) => {
    await slow.promise;
    if (isCurrent()) changes = ["committed.cs"];
  });
  await Promise.resolve();
  let queuedRan = false;
  const queued = queue.run(async () => { queuedRan = true; });
  await queue.run(async (isCurrent) => { if (isCurrent()) changes = []; }, true);
  assert.deepEqual(changes, []);
  slow.resolve();
  await Promise.all([automatic, queued]);
  assert.deepEqual(changes, []);
  assert.equal(queuedRan, false);
});

test("自动扫描串行执行，失败不会堵塞后续任务", async () => {
  const queue = new ScanRefreshQueue();
  const gate = deferred();
  const order = [];
  const first = queue.run(async () => { await gate.promise; order.push(1); throw new Error("扫描失败"); });
  const failure = assert.rejects(first, /扫描失败/);
  const second = queue.run(async () => { order.push(2); });
  assert.deepEqual(order, []);
  gate.resolve();
  await Promise.all([failure, second]);
  assert.deepEqual(order, [1, 2]);
});

test("切换目录或完整刷新后，旧局部结果失效，新任务不必等待", async () => {
  const queue = new ScanRefreshQueue();
  const gate = deferred();
  let staleApplied = false;
  const stale = queue.run(async (isCurrent) => { await gate.promise; staleApplied = isCurrent(); });
  await Promise.resolve();
  queue.invalidate();
  assert.equal(await queue.run(async () => "new scope"), "new scope");
  gate.resolve();
  await stale;
  assert.equal(staleApplied, false);
});
