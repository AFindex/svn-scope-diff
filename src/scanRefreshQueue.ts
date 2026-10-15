// 显式刷新越过耗时的自动扫描，旧任务完成后不得覆盖新结果
export class ScanRefreshQueue {
  private generation = 0;
  private scopeGeneration = 0;
  private tail = Promise.resolve();

  invalidate() {
    this.scopeGeneration += 1;
    this.generation += 1;
    this.tail = Promise.resolve();
  }

  async run<T>(task: (isCurrent: () => boolean) => Promise<T>, priority = false) {
    if (priority) { this.generation += 1; this.tail = Promise.resolve(); }
    const generation = this.generation;
    const scopeGeneration = this.scopeGeneration;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const isCurrent = () => scopeGeneration === this.scopeGeneration
      && (priority || generation === this.generation);
    try {
      if (!isCurrent()) return undefined;
      return await task(isCurrent);
    } finally {
      release();
    }
  }
}
