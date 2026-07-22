export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await delay(ms);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
