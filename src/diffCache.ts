import type { ChangeEntry, DiffResult, FileFingerprint } from "./types";

interface DiffCacheEntry {
  changeIdentity: string;
  fingerprint: FileFingerprint;
  result: DiffResult;
}

function cacheKey(path: string) {
  return path.toLowerCase();
}

function changeIdentity(change: ChangeEntry) {
  return `${change.item}\0${change.isDirectory}\0${change.baseRevision ?? ""}`;
}

export function sameFingerprint(left: FileFingerprint, right: FileFingerprint) {
  return left.exists === right.exists
    && left.isDirectory === right.isDirectory
    && left.size === right.size
    && left.modifiedNs === right.modifiedNs;
}

export class DiffCache {
  private readonly entries = new Map<string, DiffCacheEntry>();
  private limit: number;

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }

  setLimit(limit: number) {
    this.limit = Math.max(1, limit);
    this.trim();
  }

  clear() {
    this.entries.clear();
  }

  get(change: ChangeEntry, fingerprint: FileFingerprint) {
    const key = cacheKey(change.path);
    const cached = this.entries.get(key);
    if (
      !cached
      || cached.changeIdentity !== changeIdentity(change)
      || !sameFingerprint(cached.fingerprint, fingerprint)
    ) {
      if (cached) this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, cached);
    return cached.result;
  }

  put(change: ChangeEntry, fingerprint: FileFingerprint, result: DiffResult) {
    const key = cacheKey(change.path);
    this.entries.delete(key);
    this.entries.set(key, {
      changeIdentity: changeIdentity(change),
      fingerprint,
      result,
    });

    this.trim();
  }

  private trim() {
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
