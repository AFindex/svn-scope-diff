import type { ChangeEntry } from "./types";

export const TEXT_DIFF_EXTENSIONS = [
  "bat",
  "c",
  "cc",
  "cfg",
  "cmake",
  "cmd",
  "conf",
  "cpp",
  "cs",
  "css",
  "csx",
  "cxx",
  "go",
  "gradle",
  "h",
  "hpp",
  "htm",
  "html",
  "hxx",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lua",
  "mjs",
  "php",
  "properties",
  "ps1",
  "py",
  "pyw",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svelte",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
] as const;

const textDiffExtensionSet = new Set<string>(TEXT_DIFF_EXTENSIONS);

export function isTextDiffChange(change: ChangeEntry, extensions: ReadonlySet<string> = textDiffExtensionSet) {
  if (change.isDirectory) return false;
  const fileName = change.path.split(/[\\/]/).at(-1) ?? "";
  const separator = fileName.lastIndexOf(".");
  if (separator <= 0 || separator === fileName.length - 1) return false;
  return extensions.has(fileName.slice(separator + 1).toLowerCase());
}

export function textDiffChanges(changes: ChangeEntry[], extensions: readonly string[] = TEXT_DIFF_EXTENSIONS) {
  const selectedExtensions = new Set(normalizeTextDiffExtensions(extensions.join(" ")));
  return changes.filter((change) => isTextDiffChange(change, selectedExtensions));
}

export const TEXT_DIFF_EXTENSIONS_STORAGE_KEY = "svn-scope.text-diff-extensions";

// 自定义后缀支持点号、通配符及常用分隔符
export function normalizeTextDiffExtensions(extensionText: string) {
  return [...new Set(extensionText.toLowerCase().split(/[\s,;，；]+/)
    .map((extension) => extension.replace(/^\*?\./, "")).filter(Boolean))];
}

export function readTextDiffExtensions(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(TEXT_DIFF_EXTENSIONS_STORAGE_KEY) ?? "null");
    if (Array.isArray(stored) && stored.every((extension) => typeof extension === "string")) {
      return normalizeTextDiffExtensions(stored.join(" "));
    }
  } catch { /* 无法读取设置时使用默认白名单 */ }
  return [...TEXT_DIFF_EXTENSIONS];
}

export function saveTextDiffExtensions(extensions: string[]) {
  try { window.localStorage.setItem(TEXT_DIFF_EXTENSIONS_STORAGE_KEY, JSON.stringify(extensions)); }
  catch { /* 存储不可用时仍保留本次会话的选择 */ }
}
