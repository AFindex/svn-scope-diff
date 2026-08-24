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

export function isTextDiffChange(change: ChangeEntry) {
  if (change.isDirectory) return false;
  const fileName = change.path.split(/[\\/]/).at(-1) ?? "";
  const separator = fileName.lastIndexOf(".");
  if (separator <= 0 || separator === fileName.length - 1) return false;
  return textDiffExtensionSet.has(fileName.slice(separator + 1).toLowerCase());
}

export function textDiffChanges(changes: ChangeEntry[]) {
  return changes.filter(isTextDiffChange);
}
