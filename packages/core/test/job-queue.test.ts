import { describe, expect, it } from "vitest";
import { JobCancelledError, JobTimeoutError, PriorityHeap, PriorityJobQueue, QueueClosedError, QueueFullError } from "../src/index.ts";
import type { Timers } from "../src/index.ts";

function manualTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const timers: Timers = {
    set: (run) => {
      pending.set(next, run);
      return next++;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  const fireAll = () => {
    for (const [id, run] of [...pending]) {
      pending.delete(id);
      run();
    }
  };
  return { timers, fireAll, pending };
}

function gate<T = string>() {
  let open: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function abortable(signal: AbortSignal, until: Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
    void until.then(resolve);
  });
}

describe("PriorityHeap", () => {
  it("pops in priority order", () => {
    const heap = new PriorityHeap<number>((a, b) => a > b);
    for (const value of [5, 1, 9, 3, 7, 2, 8]) {
      heap.push(value);
    }
    const out: number[] = [];
    for (let value = heap.pop(); value !== undefined; value = heap.pop()) {
      out.push(value);
    }
    expect(out).toEqual([9, 8, 7, 5, 3, 2, 1]);
    expect(heap.pop()).toBeUndefined();
  });
});

describe("PriorityJobQueue", () => {
  it("never runs more than the concurrency limit and starts higher priority first", async () => {
    const queue = new PriorityJobQueue({ concurrency: 2, maxQueued: 10 });
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const job = (name: string, priority: number) => {
      gates.set(name, gate());
      return queue.enqueue(async () => {
        started.push(name);
        return gates.get(name)?.promise ?? "";
      }, { priority });
    };
    const results = [job("a", 0), job("b", 0), job("low", 0), job("high", 5), job("low2", 0)].map((item) => item.result);
    await flush();
    expect(started).toEqual(["a", "b"]);
    expect(queue.stats).toEqual({ queued: 3, running: 2 });
    gates.get("a")?.open("a");
    await flush();
    expect(started).toEqual(["a", "b", "high"]);
    for (const item of gates.values()) {
      item.open("done");
    }
    await Promise.all(results);
    expect(started).toEqual(["a", "b", "high", "low", "low2"]);
    expect(queue.stats).toEqual({ queued: 0, running: 0 });
  });

  it("refuses work past the waiting limit", async () => {
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 1 });
    const hold = gate();
    const first = queue.enqueue(() => hold.promise);
    const second = queue.enqueue(async () => "second");
    await flush();
    const third = queue.enqueue(async () => "third");
    await expect(third.result).rejects.toBeInstanceOf(QueueFullError);
    hold.open("first");
    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
  });

  it("cancels waiting jobs without running them and aborts running ones", async () => {
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 });
    const hold = gate();
    let waitingRan = false;
    const running = queue.enqueue((signal) => abortable(signal, hold.promise));
    const waiting = queue.enqueue(async () => {
      waitingRan = true;
      return "x";
    });
    await flush();
    expect(queue.cancel(waiting.id)).toBe(true);
    expect(queue.cancel(waiting.id)).toBe(false);
    await expect(waiting.result).rejects.toBeInstanceOf(JobCancelledError);
    expect(queue.cancel(running.id)).toBe(true);
    await expect(running.result).rejects.toBeInstanceOf(JobCancelledError);
    await flush();
    expect(waitingRan).toBe(false);
    expect(queue.cancel("job-unknown")).toBe(false);
  });

  it("follows a caller's abort signal, including one aborted before enqueue", async () => {
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 });
    const controller = new AbortController();
    const job = queue.enqueue((signal) => abortable(signal, gate().promise), { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(job.result).rejects.toBeInstanceOf(JobCancelledError);
    await expect(queue.enqueue(async () => "x", { signal: controller.signal }).result).rejects.toBeInstanceOf(JobCancelledError);
  });

  it("times out running time only, then frees the slot", async () => {
    const { timers, fireAll, pending } = manualTimers();
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 }, timers);
    const slow = queue.enqueue((signal) => abortable(signal, gate().promise), { timeoutMs: 1_000 });
    const next = queue.enqueue(async () => "next", { timeoutMs: 1_000 });
    await flush();
    expect(pending.size).toBe(1);
    fireAll();
    await expect(slow.result).rejects.toBeInstanceOf(JobTimeoutError);
    await expect(next.result).resolves.toBe("next");
    expect(pending.size).toBe(0);
  });

  it("reports progress until the job settles and passes failures through", async () => {
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 });
    const seen: string[] = [];
    let later: (() => void) | null = null;
    const job = queue.enqueue(
      async (_signal, report) => {
        report(1, 2);
        later = () => report(2, 2);
        throw new Error("build failed");
      },
      { onProgress: (progress) => seen.push(`${progress.jobId}:${progress.completed}/${progress.total}`) },
    );
    await expect(job.result).rejects.toThrow("build failed");
    await flush();
    (later as (() => void) | null)?.();
    expect(seen).toEqual([`${job.id}:1/2`]);
  });

  it("shuts down: fails waiting jobs, refuses new ones, and aborts running jobs after the grace period", async () => {
    const { timers, fireAll } = manualTimers();
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 }, timers);
    const running = queue.enqueue((signal) => abortable(signal, gate().promise));
    const waiting = queue.enqueue(async () => "never");
    await flush();
    const stopped = queue.shutdown(5_000);
    await expect(waiting.result).rejects.toBeInstanceOf(QueueClosedError);
    await expect(queue.enqueue(async () => "late").result).rejects.toBeInstanceOf(QueueClosedError);
    fireAll();
    await expect(running.result).rejects.toBeInstanceOf(QueueClosedError);
    await expect(stopped).resolves.toBeUndefined();
    await expect(new PriorityJobQueue({ concurrency: 1, maxQueued: 0 }).shutdown(10)).resolves.toBeUndefined();
  });

  it("lets running jobs finish within the grace period", async () => {
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 }, manualTimers().timers);
    const hold = gate();
    const running = queue.enqueue(() => hold.promise);
    await flush();
    const stopped = queue.shutdown(5_000);
    hold.open("finished");
    await expect(running.result).resolves.toBe("finished");
    await expect(stopped).resolves.toBeUndefined();
  });

  it("starts a job straight away when a slot is free and catches a synchronous throw", async () => {
    const queue = new PriorityJobQueue({ concurrency: 1, maxQueued: 5 });
    let started = false;
    const job = queue.enqueue(async () => {
      started = true;
      return "ok";
    });
    expect(started).toBe(true);
    await expect(job.result).resolves.toBe("ok");
    const thrown = queue.enqueue(() => {
      throw new Error("sync");
    });
    await expect(thrown.result).rejects.toThrow("sync");
    await expect(queue.enqueue(async () => "after").result).resolves.toBe("after");
  });

  it("rejects invalid limits", () => {
    expect(() => new PriorityJobQueue({ concurrency: 0, maxQueued: 1 })).toThrow(RangeError);
    expect(() => new PriorityJobQueue({ concurrency: 1, maxQueued: -1 })).toThrow(RangeError);
  });
});
