export const DEFAULT_SIDEBAR_WIDTH = 348;
export const MIN_SIDEBAR_WIDTH = 280;
export const MAX_SIDEBAR_WIDTH = 680;
export const MIN_DIFF_WIDTH = 420;
export const SIDEBAR_RESIZE_HANDLE_WIDTH = 10;
export const SIDEBAR_KEYBOARD_STEP = 18;

export function sidebarMaxWidth(viewportWidth: number) {
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(
      MAX_SIDEBAR_WIDTH,
      viewportWidth - MIN_DIFF_WIDTH - SIDEBAR_RESIZE_HANDLE_WIDTH,
    ),
  );
}

export function clampSidebarWidth(width: number, viewportWidth: number) {
  return Math.round(Math.min(
    sidebarMaxWidth(viewportWidth),
    Math.max(MIN_SIDEBAR_WIDTH, width),
  ));
}

export function sidebarWidthFromKey(
  width: number,
  key: string,
  shiftKey: boolean,
  viewportWidth: number,
) {
  const step = shiftKey ? SIDEBAR_KEYBOARD_STEP * 3 : SIDEBAR_KEYBOARD_STEP;
  if (key === "ArrowLeft") return clampSidebarWidth(width - step, viewportWidth);
  if (key === "ArrowRight") return clampSidebarWidth(width + step, viewportWidth);
  if (key === "Home") return MIN_SIDEBAR_WIDTH;
  if (key === "End") return sidebarMaxWidth(viewportWidth);
  return undefined;
}
