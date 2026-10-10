const STORAGE_KEY = "svn-scope.recent-directories";
export function rememberDirectories(history: string[], directories: string[]) {
  const result: string[] = [];
  const keys = new Set<string>();
  for (const path of [...directories, ...history]) {
    const key = path.replaceAll("/", "\\").replace(/[\\/]+$/, "").toLowerCase();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    result.push(path);
  }
  return result.slice(0, 12);
}
export function readRecentDirectories(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? rememberDirectories([], stored.filter((path): path is string => typeof path === "string")) : [];
  } catch { return []; }
}
export function saveRecentDirectories(history: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch { /* Session history remains available */ }
}
