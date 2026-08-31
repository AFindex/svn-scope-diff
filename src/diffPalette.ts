import type { ChangeEntry } from "./types";

export type DiffPalette = "status" | "contrast" | "classic";
export type EffectiveDiffPalette = "new" | "contrast" | "classic";

export function effectiveDiffPalette(
  palette: DiffPalette,
  selected?: Pick<ChangeEntry, "item">,
): EffectiveDiffPalette {
  if (palette === "status") {
    return selected && ["added", "unversioned"].includes(selected.item)
      ? "new"
      : "classic";
  }
  return palette;
}

export function monacoThemeForPalette(palette: EffectiveDiffPalette) {
  if (palette === "new") return "svn-scope-new-file";
  if (palette === "contrast") return "svn-scope-high-contrast";
  return "svn-scope-light";
}
