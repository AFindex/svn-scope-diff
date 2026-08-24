import type { ChangeEntry } from "./types";

export type ListFilterMode = "text" | "extension";

export const ALL_FILE_TYPES = "__all__";
export const DIRECTORY_FILE_TYPE = "__directory__";
export const NO_EXTENSION_FILE_TYPE = "__no_extension__";

export interface FileTypeOption {
  value: string;
  label: string;
  count: number;
}

export function extensionOf(change: ChangeEntry) {
  if (change.isDirectory) return DIRECTORY_FILE_TYPE;
  const dot = change.name.lastIndexOf(".");
  return dot > 0 && dot < change.name.length - 1
    ? change.name.slice(dot + 1).toLowerCase()
    : NO_EXTENSION_FILE_TYPE;
}

export function extensionLabel(value: string) {
  if (value === DIRECTORY_FILE_TYPE) return "目录";
  if (value === NO_EXTENSION_FILE_TYPE) return "无后缀";
  return `.${value}`;
}

export function directoryOf(change: ChangeEntry) {
  const slash = change.relativePath.lastIndexOf("/");
  const backslash = change.relativePath.lastIndexOf("\\");
  const separator = Math.max(slash, backslash);
  return separator >= 0 ? change.relativePath.slice(0, separator) : ".";
}

export function fileTypeOptions(changes: ChangeEntry[]) {
  const counts = new Map<string, number>();
  for (const change of changes) {
    const extension = extensionOf(change);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }

  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return [...counts.entries()]
    .map<FileTypeOption>(([value, count]) => ({
      value,
      label: extensionLabel(value),
      count,
    }))
    .sort((left, right) => {
      if (left.value === DIRECTORY_FILE_TYPE) return -1;
      if (right.value === DIRECTORY_FILE_TYPE) return 1;
      if (left.value === NO_EXTENSION_FILE_TYPE) return 1;
      if (right.value === NO_EXTENSION_FILE_TYPE) return -1;
      return collator.compare(left.label, right.label);
    });
}

export function filterChanges(
  changes: ChangeEntry[],
  mode: ListFilterMode,
  text: string,
  extension: string,
) {
  if (mode === "extension") {
    if (extension === ALL_FILE_TYPES) return [...changes];
    return changes.filter((change) => extensionOf(change) === extension);
  }

  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...changes];
  return changes.filter((change) => {
    const candidate = `${change.name}\n${change.relativePath}`.toLowerCase();
    return terms.every((term) => candidate.includes(term));
  });
}
