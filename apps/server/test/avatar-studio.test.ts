import { describe, expect, it } from "vitest";
import type { AvatarJobStatus } from "@look-studio/shared";
import { AvatarBlockedError, AvatarStudio, failureMessage, overallProgress } from "../src/lib/avatar-studio.ts";
import type { AvatarStudioDeps } from "../src/lib/avatar-studio.ts";
import { FakeConceptService, emptyGlb } from "../src/lib/avatar-fakes.ts";
import { InlineJobQueue } from "../src/lib/inline-job-queue.ts";
import type { AvatarBuild, AvatarModelProvider, BuildStage } from "../src/lib/meshy-avatar.ts";
import { MeshyError } from "../src/lib/meshy-client.ts";
import { toVerdict } from "../src/lib/moderation.ts";
import type { ModerationService } from "../src/lib/moderation.ts";

const GLB_URL = "https://assets.meshy.ai/rig.glb";

function deferredProvider() {
  let finish: (build: AvatarBuild) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  let report: (stage: BuildStage, progress: number) => void = () => {};
  const cleaned: string[] = [];
  const provider: AvatarModelProvider = {
    build: (image, _description, _signal, onProgress) => {
      report = onProgress;
      return new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
        void image;
      });
    },
  };
  return {
    provider,
    cleaned,
    progress: (stage: BuildStage, value: number) => report(stage, value),
    succeed: () => finish({ glbUrl: GLB_URL, cleanup: async () => void cleaned.push("cleaned") }),
    fail: (error: unknown) => fail(error),
  };
}

function studio(overrides: Partial<AvatarStudioDeps> = {}, clock = { t: 0 }) {
  let id = 0;
  let built = 0;
  const deps: AvatarStudioDeps = {
    moderation: { check: async () => ({ allowed: true, category: "ok" }) },
    concepts: new FakeConceptService(),
    provider: deferredProvider().provider,
    queue: new InlineJobQueue(),
    now: () => clock.t,
    newId: () => String((id += 1)),
    onAvatarBuilt: () => {
      built += 1;
    },
    fetch: async (url) => (String(url) === GLB_URL ? new Response(emptyGlb()) : new Response("missing", { status: 404 })),
    ...overrides,
  };
  return { service: new AvatarStudio(deps), built: () => built };
}

const signal = () => new AbortController().signal;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("avatar progress and messages", () => {
  it("maps modeling to the first three quarters and holds 100 for ready", () => {
    expect(overallProgress("modeling", 0)).toBe(0);
    expect(overallProgress("modeling", 100)).toBe(74);
    expect(overallProgress("rigging", 100)).toBe(99);
    expect(overallProgress("rigging", -5)).toBe(74);
  });

  it("explains failures without internals", () => {
    expect(failureMessage(new MeshyError("pose_failed", 422))).toContain("humanoid");
    expect(failureMessage(new Error("secret detail"))).not.toContain("secret");
  });

  it("fails moderation closed", () => {
    expect(toVerdict({ allowed: true, category: "ok" })).toEqual({ allowed: true, category: "ok" });
    expect(toVerdict({ allowed: true, category: "sexual" })).toEqual({ allowed: false, category: "sexual" });
    expect(toVerdict({ allowed: false, category: "ok" })).toEqual({ allowed: false, category: "other_unsafe" });
  });
});

describe("AvatarStudio", () => {
  it("moderates before drawing anything", async () => {
    let drawn = 0;
    const moderation: ModerationService = { check: async () => ({ allowed: false, category: "hate_or_caricature" }) };
    const { service } = studio({
      moderation,
      concepts: {
        createConcepts: async () => {
          drawn += 1;
          return [];
        },
      },
    });
    await expect(service.createConcepts("x", undefined, signal())).rejects.toBeInstanceOf(AvatarBlockedError);
    expect(drawn).toBe(0);
  });

  it("only builds concepts it drew, once each, before they expire", async () => {
    const clock = { t: 0 };
    const { service } = studio({}, clock);
    const concepts = await service.createConcepts("robot barista", undefined, signal());
    expect(concepts).toHaveLength(3);
    expect(service.startJob("concept-forged")).toBeNull();
    const first = concepts[0]?.id ?? "";
    expect(service.startJob(first)).not.toBeNull();
    expect(service.startJob(first)).toBeNull();
    clock.t += 31 * 60_000;
    expect(service.startJob(concepts[1]?.id ?? "")).toBeNull();
  });

  it("streams progress to ready, then hands over the model once and cleans up", async () => {
    const run = deferredProvider();
    const { service, built } = studio({ provider: run.provider });
    const [concept] = await service.createConcepts("robot", undefined, signal());
    const jobId = service.startJob(concept?.id ?? "") ?? "";
    const seen: AvatarJobStatus[] = [];
    const watching = service.subscribe(jobId, async (status) => void seen.push(status), signal());
    run.progress("modeling", 50);
    run.progress("rigging", 50);
    expect(await service.fetchModel(jobId, signal())).toBeNull();
    run.succeed();
    await watching;
    expect(seen.map((status) => status.stage)).toEqual(["queued", "modeling", "rigging", "ready"]);
    expect(built()).toBe(1);
    const model = await service.fetchModel(jobId, signal());
    expect(model?.headers.get("content-type")).toBe("model/gltf-binary");
    expect(new Uint8Array(await (model ?? new Response()).arrayBuffer()).slice(0, 4)).toEqual(new TextEncoder().encode("glTF"));
    expect(run.cleaned).toEqual(["cleaned"]);
    expect(service.getJob(jobId)).toBeNull();
  });

  it("reports a friendly failure and keeps the last progress", async () => {
    const run = deferredProvider();
    const { service, built } = studio({ provider: run.provider });
    const [concept] = await service.createConcepts("robot", undefined, signal());
    const jobId = service.startJob(concept?.id ?? "") ?? "";
    run.progress("modeling", 40);
    run.fail(new MeshyError("pose_failed", 422));
    await flush();
    expect(service.getJob(jobId)).toMatchObject({ stage: "failed", progress: 30, error: expect.stringContaining("humanoid") });
    expect(built()).toBe(0);
  });

  it("stops streaming when the client goes away", async () => {
    const run = deferredProvider();
    const { service } = studio({ provider: run.provider });
    const [concept] = await service.createConcepts("robot", undefined, signal());
    const jobId = service.startJob(concept?.id ?? "") ?? "";
    const controller = new AbortController();
    const watching = service.subscribe(jobId, async () => {}, controller.signal);
    controller.abort();
    await expect(watching).resolves.toBeUndefined();
  });
});
