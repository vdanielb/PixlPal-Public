/** Compact elapsed-turn clock: `0m05s`, `1m23s`. */
export function formatTurnClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

/** ISO-8601 duration for a `<time dateTime>` value. */
export function formatTurnClockIso(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `PT${minutes}M${seconds}S`;
}
