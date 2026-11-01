export class PriorityHeap<T> {
  private readonly items: T[] = [];
  private readonly before: (a: T, b: T) => boolean;

  constructor(before: (a: T, b: T) => boolean) {
    this.before = before;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(this.at(index), this.at(parent))) {
        return;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined || this.items.length === 0) {
      return top;
    }
    this.items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.items.length && this.before(this.at(left), this.at(best))) {
        best = left;
      }
      if (right < this.items.length && this.before(this.at(right), this.at(best))) {
        best = right;
      }
      if (best === index) {
        return top;
      }
      this.swap(index, best);
      index = best;
    }
  }

  drain(): T[] {
    return this.items.splice(0);
  }

  private at(index: number): T {
    return this.items[index] as T;
  }

  private swap(a: number, b: number): void {
    const item = this.at(a);
    this.items[a] = this.at(b);
    this.items[b] = item;
  }
}
