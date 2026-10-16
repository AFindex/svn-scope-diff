// Monaco 会统一模型换行符，显示时的换行归一化不算用户编辑
export function getEditorDraft(content: string, baseline: string | undefined) {
  if (baseline === undefined) return undefined;
  const normalize = (text: string) => text.replace(/\r\n|\r/g, "\n");
  return normalize(content) === normalize(baseline) ? undefined : content;
}
