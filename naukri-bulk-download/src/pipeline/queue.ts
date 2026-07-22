export class SimpleQueue<T> {
  private queue: T[] = [];
  private running = 0;

  constructor(private concurrency: number) {}

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task as unknown as T);
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift() as unknown as () => Promise<void>;
      this.running++;
      job()
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          void this.pump();
        });
    }
  }

  async drain(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
