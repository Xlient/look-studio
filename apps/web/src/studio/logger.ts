export type LogValue = string | number | boolean | null;

export function logEvent(fields: Record<string, LogValue>): void {
  console.info(JSON.stringify(fields));
}
