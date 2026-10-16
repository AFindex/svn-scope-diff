import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformWithOxc } from "vite";

const sourcePath = fileURLToPath(new URL("../src/editorDraft.ts", import.meta.url));
const { code } = await transformWithOxc(await readFile(sourcePath, "utf8"), sourcePath);
const { getEditorDraft } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("混合换行文件放弃编辑后不再产生假草稿", () => {
  const baseline = "class Player\r\n{\n    int health = 200;\r\n}\r\n";
  const displayed = baseline.replace(/\r\n|\r/g, "\n").replaceAll("\n", "\r\n");
  assert.notEqual(displayed, baseline);
  assert.equal(getEditorDraft(displayed, baseline), undefined);
  assert.equal(getEditorDraft(baseline.replaceAll("\r\n", "\n"), baseline), undefined);
});

test("LF 与 CRLF 的 asmdef 相互切换时不把模型换行当成草稿", () => {
  const lf = '{\n    "name": "Example.Editor"\n}\n';
  const crlf = lf.replaceAll("\n", "\r\n");
  assert.equal(getEditorDraft(crlf, lf), undefined);
  assert.equal(getEditorDraft(lf, crlf), undefined);
});

test("真实编辑、空文件和末尾换行变化仍保留草稿", () => {
  for (const [content, baseline] of [["changed\r\n", "base\n"], ["", "base"], ["base\n", "base"], [" base", "base"]]) {
    assert.equal(getEditorDraft(content, baseline), content);
  }
});

test("撤销回原文、保存后更新基线、卸载编辑器均不遗留草稿", () => {
  assert.equal(getEditorDraft("base\r\n", "base\n"), undefined);
  assert.equal(getEditorDraft("saved\r\n", "saved\r\n"), undefined);
  assert.equal(getEditorDraft("", undefined), undefined);
});
