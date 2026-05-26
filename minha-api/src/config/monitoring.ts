const MINUTES_PER_DAY = 24 * 60;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES = positiveNumber(
  process.env.PROCESSO_MONITORING_INTERVAL_MINUTES,
  MINUTES_PER_DAY
);

export const DEFAULT_MONITORING_POLL_INTERVAL_MS = positiveNumber(
  process.env.MONITORING_INTERVAL_MS,
  5 * 60 * 1000
);

export function normalizeProcessMonitoringInterval(value?: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_PROCESS_MONITORING_INTERVAL_MINUTES;
}
