import { describe, expect, it } from "vitest";
import type { AvatarJobStatus } from "@look-studio/shared";
import type { FetchLike } from "../src/studio/api-client.ts";
import {
  POLL_INTERVAL_MS,
  POLL_MAX_WAIT_MS,
  downloadAvatarModel,
  getAvatarStatus,
  pollAvatarJob,
  requestConcepts,
  startAvatar,
} from "../src/studio/avatar-client.ts";

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeFetch(responses: (Response | Error)[]): { fetchFn: FetchLike; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetchFn: (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next === undefined) {
        throw new Error("unexpected call");
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

const signal = new AbortController().signal;

describe("requestConcepts", () => {
  it("returns validated concepts and sends the photo only when given", async () => {
    const { fetchFn, calls } = fakeFetch([json({ ok: true, concepts: [{ id: "c1", image: IMAGE }] })]);
    const result = await requestConcepts({ description: "fox barista" }, { signal, fetchFn });
    expect(result).toEqual({ ok: true, concepts: [{ id: "c1", image: IMAGE }] });
    expect(calls[0]?.url).toBe("/api/avatar/concepts");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ description: "fox barista" });
  });

  it("rejects concepts that are not image data URLs", async () => {
    const { fetchFn } = fakeFetch([json({ ok: true, concepts: [{ id: "c1", image: "https://example.com/a.png" }] })]);
    expect(await requestConcepts({ description: "fox" }, { signal, fetchFn })).toMatchObject({ ok: false, error: "bad_response" });
  });

  it("passes through a moderation block", async () => {
    const { fetchFn } = fakeFetch([json({ ok: false, error: "avatar_blocked", category: "real_person" }, 422)]);
    expect(await requestConcepts({ description: "x" }, { signal, fetchFn })).toEqual({ ok: false, error: "avatar_blocked", retryAfterS: null });
  });
});

describe("startAvatar", () => {
  it("returns the job id", async () => {
    const { fetchFn, calls } = fakeFetch([json({ ok: true, jobId: "job-1" })]);
    expect(await startAvatar("c1", { signal, fetchFn })).toEqual({ ok: true, jobId: "job-1" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ conceptId: "c1" });
  });

  it("reads Retry-After on the daily limit", async () => {
    const { fetchFn } = fakeFetch([json({ ok: false, error: "avatar_daily_limit" }, 429, { "retry-after": "7200" })]);
    expect(await startAvatar("c1", { signal, fetchFn })).toEqual({ ok: false, error: "avatar_daily_limit", retryAfterS: 7200 });
  });
});

describe("getAvatarStatus", () => {
  it("rejects a status for another job", async () => {
    const { fetchFn } = fakeFetch([json({ ok: true, status: { jobId: "other", stage: "modeling", progress: 10 } })]);
    expect(await getAvatarStatus("job-1", { signal, fetchFn })).toMatchObject({ ok: false, error: "bad_response" });
  });

  it("maps a network failure", async () => {
    const { fetchFn } = fakeFetch([new TypeError("offline")]);
    expect(await getAvatarStatus("job-1", { signal, fetchFn })).toMatchObject({ ok: false, error: "network" });
  });
});

describe("downloadAvatarModel", () => {
  it("returns the bytes", async () => {
    const { fetchFn, calls } = fakeFetch([new Response(new Uint8Array([1, 2, 3]))]);
    const result = await downloadAvatarModel("job 1", { signal, fetchFn });
    expect(result.ok && result.model.byteLength).toBe(3);
    expect(calls[0]?.url).toBe("/api/avatar/job%201/model");
  });

  it("rejects an empty body and passes server errors through", async () => {
    const empty = fakeFetch([new Response(new Uint8Array(0))]);
    expect(await downloadAvatarModel("job-1", { signal, fetchFn: empty.fetchFn })).toMatchObject({ ok: false, error: "bad_response" });
    const gone = fakeFetch([json({ ok: false, error: "model_not_ready" }, 404)]);
    expect(await downloadAvatarModel("job-1", { signal, fetchFn: gone.fetchFn })).toMatchObject({ ok: false, error: "model_not_ready" });
  });
});

function status(stage: AvatarJobStatus["stage"], progress: number): Response {
  return json({ ok: true, status: { jobId: "job-1", stage, progress } });
}

function clock() {
  let nowMs = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => nowMs,
    sleep: (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
      return Promise.resolve();
    },
  };
}

describe("pollAvatarJob", () => {
  it("reports each status until ready", async () => {
    const { fetchFn } = fakeFetch([status("queued", 0), status("modeling", 40), status("ready", 100)]);
    const time = clock();
    const seen: number[] = [];
    const result = await pollAvatarJob("job-1", { signal, fetchFn, ...time, onStatus: (s) => seen.push(s.progress) });
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([0, 40, 100]);
    expect(time.sleeps).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
  });

  it("stops on a failed build", async () => {
    const { fetchFn } = fakeFetch([status("failed", 30)]);
    const result = await pollAvatarJob("job-1", { signal, fetchFn, ...clock(), onStatus: () => {} });
    expect(result).toMatchObject({ ok: false, error: "avatar_failed" });
  });

  it("rides out brief network drops but gives up after three in a row", async () => {
    const recovered = fakeFetch([new TypeError("x"), new TypeError("x"), status("ready", 100)]);
    expect(await pollAvatarJob("job-1", { signal, fetchFn: recovered.fetchFn, ...clock(), onStatus: () => {} })).toEqual({ ok: true });
    const down = fakeFetch([new TypeError("x"), new TypeError("x"), new TypeError("x")]);
    expect(await pollAvatarJob("job-1", { signal, fetchFn: down.fetchFn, ...clock(), onStatus: () => {} })).toMatchObject({
      ok: false,
      error: "network",
    });
  });

  it("returns a lost job straight away", async () => {
    const { fetchFn } = fakeFetch([json({ ok: false, error: "job_not_found" }, 404)]);
    expect(await pollAvatarJob("job-1", { signal, fetchFn, ...clock(), onStatus: () => {} })).toMatchObject({ error: "job_not_found" });
  });

  it("times out after the maximum wait", async () => {
    const responses = Array.from({ length: POLL_MAX_WAIT_MS / POLL_INTERVAL_MS + 1 }, () => status("modeling", 50));
    const { fetchFn } = fakeFetch(responses);
    expect(await pollAvatarJob("job-1", { signal, fetchFn, ...clock(), onStatus: () => {} })).toMatchObject({ error: "timeout" });
  });

  it("stops when aborted during a wait", async () => {
    const controller = new AbortController();
    const { fetchFn } = fakeFetch([status("modeling", 10)]);
    const result = await pollAvatarJob("job-1", {
      signal: controller.signal,
      fetchFn,
      now: () => 0,
      sleep: () => {
        controller.abort();
        return Promise.reject(new Error("aborted"));
      },
      onStatus: () => {},
    });
    expect(result).toMatchObject({ ok: false, error: "aborted" });
  });
});
