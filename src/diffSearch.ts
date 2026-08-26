export function wrapSearchMatchIndex(index: number, matchCount: number) {
  if (matchCount <= 0) return -1;
  return ((index % matchCount) + matchCount) % matchCount;
}
