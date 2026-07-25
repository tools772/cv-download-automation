/** Absolute ceiling for Naukri / Instahyre CVs in a single companion fetch. */
export const HARD_MAX_PLATFORM_FETCH_CVS = 50;

export function clampDownloadLimit(value: unknown, fallback = 10): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return Math.min(HARD_MAX_PLATFORM_FETCH_CVS, Math.max(1, fallback));
  return Math.min(HARD_MAX_PLATFORM_FETCH_CVS, Math.max(1, Math.trunc(n)));
}
