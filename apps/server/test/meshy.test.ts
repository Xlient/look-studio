import { describe, expect, it, vi } from "vitest";
import { MESHY_BASE_URL, MeshyError, createMeshyClient, mapMeshyStatus } from "../src/lib/meshy-client.ts";
import type { MeshyClient, MeshyTask, MeshyTaskKind } from "../src/lib/meshy-client.ts";
import { MeshyAvatarProvider } from "../src/lib/meshy-avatar.ts";
import { ExponentialBackoffRetryPolicy } from "../src/lib/retry-policy.ts";

const KEY = "test-meshy-key";
const IMAGE = "data:image/webp;base64,AAAA";

function recordingFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("no response queued");
    }
    return next;
  };
  return { calls, fetchFn };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("Meshy client", () => {
  it("creates an A-pose, moderated, textured image-to-3D task with the key in the header only", async () => {
    const { calls, fetchFn } = recordingFetch([json({ result: "task-1" })]);
    const id = await createMeshyClient(KEY, fetchFn).createImageTo3d(IMAGE, "toon", new AbortController().signal);
    expect(id).toBe("task-1");
    const call = calls[0];
    expect(call?.url).toBe(`${MESHY_BASE_URL}/image-to-3d`);
    expect(new Headers(call?.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ image_url: IMAGE, pose_mode: "a-pose", moderation: true, should_texture: true, target_formats: ["glb"] });
    expect(String(call?.init.body)).not.toContain(KEY);
  });

  it("maps HTTP errors, including Retry-After on 429", async () => {
    const client = createMeshyClient(KEY, recordingFetch([json({}, 429, { "retry-after": "7" })]).fetchFn);
    await expect(client.getTask("rigging", "t", new AbortController().signal)).rejects.toMatchObject({ kind: "rate_limited", retryAfterMs: 7000 });
    expect(mapMeshyStatus(402, null).kind).toBe("no_credits");
    expect(mapMeshyStatus(422, null).kind).toBe("pose_failed");
    expect(mapMeshyStatus(403, null).kind).toBe("rejected");
    expect(mapMeshyStatus(500, null).kind).toBe("unavailable");
    expect(mapMeshyStatus(401, null).message).not.toContain(KEY);
  });

  it("rejects malformed task bodies and reports aborts", async () => {
    const bad = createMeshyClient(KEY, recordingFetch([json({ id: "x", status: "WEIRD" })]).fetchFn);
    await expect(bad.getTask("image-to-3d", "x", new AbortController().signal)).rejects.toMatchObject({ kind: "unavailable" });
    const controller = new AbortController();
    controller.abort();
    const aborting = createMeshyClient(KEY, async () => {
      throw new Error("aborted");
    });
    await expect(aborting.getTask("image-to-3d", "x", controller.signal)).rejects.toMatchObject({ kind: "aborted" });
  });
});

function fakeClient(script: { modeling: MeshyTask[]; rigging: MeshyTask[]; failCreate?: MeshyError }) {
  const log: string[] = [];
  const client: MeshyClient = {
    async createImageTo3d() {
      log.push("create:image-to-3d");
      if (script.failCreate !== undefined) {
        throw script.failCreate;
      }
      return "model-1";
    },
    async createRigging(id) {
      log.push(`create:rigging:${id}`);
      return "rig-1";
    },
    async getTask(kind: MeshyTaskKind) {
      log.push(`get:${kind}`);
      const queue = kind === "image-to-3d" ? script.modeling : script.rigging;
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === undefined) {
        throw new Error("no task scripted");
      }
      return next;
    },
    async deleteTask(kind: MeshyTaskKind, id: string) {
      log.push(`delete:${kind}:${id}`);
    },
  };
  return { client, log };
}

const task = (status: MeshyTask["status"], progress: number, glb?: string): MeshyTask => ({
  id: "t",
  status,
  progress,
  ...(glb === undefined ? {} : { result: { rigged_character_glb_url: glb } }),
});

function provider(client: MeshyClient, clock = { t: 0 }) {
  const retry = new ExponentialBackoffRetryPolicy(() => ({ maxRetries: 2, baseMs: 0 }), async () => {}, () => 0);
  return new MeshyAvatarProvider({
    client,
    retryPolicy: retry,
    sleep: async (ms) => {
      clock.t += ms;
    },
    now: () => clock.t,
    pollMs: 1000,
    maxWaitMs: 10_000,
  });
}

describe("Meshy avatar provider", () => {
  it("models, rigs, reports progress, and cleans up both tasks afterwards", async () => {
    const { client, log } = fakeClient({
      modeling: [task("PENDING", 0), task("IN_PROGRESS", 60), task("SUCCEEDED", 100)],
      rigging: [task("IN_PROGRESS", 40), task("SUCCEEDED", 100, "https://assets.meshy.ai/rig.glb")],
    });
    const progress: string[] = [];
    const build = await provider(client).build(IMAGE, "robot barista", new AbortController().signal, (stage, p) => progress.push(`${stage}:${p}`));
    expect(build.glbUrl).toBe("https://assets.meshy.ai/rig.glb");
    expect(progress).toEqual(["modeling:0", "modeling:60", "rigging:40"]);
    expect(log.filter((line) => line.startsWith("create"))).toEqual(["create:image-to-3d", "create:rigging:model-1"]);
    await build.cleanup(new AbortController().signal);
    expect(log.filter((line) => line.startsWith("delete"))).toEqual(["delete:image-to-3d:model-1", "delete:rigging:rig-1"]);
  });

  it("logs each stage with the job id, and which stage failed", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    const { client } = fakeClient({ modeling: [task("SUCCEEDED", 100)], rigging: [task("FAILED", 10)] });
    await expect(provider(client).build(IMAGE, "secret robot", new AbortController().signal, () => {}, "job-1")).rejects.toBeInstanceOf(MeshyError);
    spy.mockRestore();
    const stages = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line["event"] === "avatar_stage");
    expect(stages).toMatchObject([
      { jobId: "job-1", stage: "modeling", status: "SUCCEEDED" },
      { jobId: "job-1", stage: "rigging", status: "ERROR", error: "rejected" },
    ]);
    expect(lines.join("\n")).not.toContain("secret robot");
  });

  it("fails on a failed task and deletes what it created", async () => {
    const { client, log } = fakeClient({ modeling: [task("SUCCEEDED", 100)], rigging: [task("FAILED", 10)] });
    await expect(provider(client).build(IMAGE, "x", new AbortController().signal, () => {})).rejects.toMatchObject({ kind: "rejected" });
    expect(log.filter((line) => line.startsWith("delete"))).toEqual(["delete:image-to-3d:model-1", "delete:rigging:rig-1"]);
  });

  it("times out when a task never finishes", async () => {
    const { client } = fakeClient({ modeling: [task("IN_PROGRESS", 5)], rigging: [] });
    await expect(provider(client).build(IMAGE, "x", new AbortController().signal, () => {})).rejects.toMatchObject({ kind: "timeout" });
  });

  it("retries rate limits but not credit errors, and refuses non-https models", async () => {
    const limited = fakeClient({ modeling: [task("SUCCEEDED", 100)], rigging: [task("SUCCEEDED", 100, "http://insecure/rig.glb")] });
    await expect(provider(limited.client).build(IMAGE, "x", new AbortController().signal, () => {})).rejects.toMatchObject({ kind: "unavailable" });
    const broke = fakeClient({ modeling: [], rigging: [], failCreate: new MeshyError("no_credits", 402) });
    await expect(provider(broke.client).build(IMAGE, "x", new AbortController().signal, () => {})).rejects.toMatchObject({ kind: "no_credits" });
    expect(broke.log.filter((line) => line === "create:image-to-3d")).toHaveLength(1);
    const busy = fakeClient({ modeling: [], rigging: [], failCreate: new MeshyError("rate_limited", 429) });
    await expect(provider(busy.client).build(IMAGE, "x", new AbortController().signal, () => {})).rejects.toMatchObject({ kind: "rate_limited" });
    expect(busy.log.filter((line) => line === "create:image-to-3d")).toHaveLength(3);
  });
});
