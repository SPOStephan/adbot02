export type IconGridNavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function isIconActivationKey(key: string) {
  return key === "Enter" || key === " ";
}

export function getNextIconGridIndex({ currentIndex, key, itemCount, columnCount }: {
  currentIndex: number;
  key: string;
  itemCount: number;
  columnCount: number;
}): number | null {
  if (itemCount <= 0) return null;
  const current = Math.min(Math.max(currentIndex, 0), itemCount - 1);
  const columns = Math.max(1, columnCount);
  const navigationKey = key as IconGridNavigationKey;

  if (navigationKey === "ArrowLeft") return Math.max(0, current - 1);
  if (navigationKey === "ArrowRight") return Math.min(itemCount - 1, current + 1);
  if (navigationKey === "ArrowUp") return Math.max(0, current - columns);
  if (navigationKey === "ArrowDown") return Math.min(itemCount - 1, current + columns);
  if (navigationKey === "Home") return 0;
  if (navigationKey === "End") return itemCount - 1;
  return null;
}
