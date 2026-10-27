export type LogValue = string | number | boolean | null;

export function logInfo(fields: Record<string, LogValue>): void {
  console.log(JSON.stringify(fields));
}
