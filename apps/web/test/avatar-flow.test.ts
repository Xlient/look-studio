import { describe, expect, it } from "vitest";
import type { AvatarConcept } from "@look-studio/shared";
import { INITIAL_FLOW, avatarFlowReducer, buildingLabel } from "../src/studio/avatar-flow.ts";
import type { AvatarFlow, AvatarFlowEvent } from "../src/studio/avatar-flow.ts";

const CONCEPTS: AvatarConcept[] = ["a", "b", "c"].map((id) => ({ id, image: "data:image/png;base64,AA==" }));

function run(events: AvatarFlowEvent[], from: AvatarFlow = INITIAL_FLOW): AvatarFlow {
  return events.reduce(avatarFlowReducer, from);
}

const toConfirm: AvatarFlowEvent[] = [{ type: "draw" }, { type: "concepts", concepts: CONCEPTS }, { type: "pick", conceptId: "b" }];

describe("avatarFlowReducer", () => {
  it("walks from description to a ready avatar", () => {
    const building = run([...toConfirm, { type: "build" }, { type: "started", jobId: "job-1" }]);
    expect(building).toMatchObject({ step: "building", jobId: "job-1", stage: "queued", progress: 0 });
    const progressed = run([{ type: "status", status: { jobId: "job-1", stage: "rigging", progress: 80 } }], building);
    expect(progressed).toMatchObject({ stage: "rigging", progress: 80 });
    expect(run([{ type: "loaded" }], progressed)).toEqual({ step: "ready", concept: CONCEPTS[1] });
  });

  it("goes back from confirm to the same concepts", () => {
    expect(run([...toConfirm, { type: "back" }])).toEqual({ step: "choose", concepts: CONCEPTS });
  });

  it("ignores picks of unknown concepts and empty concept lists", () => {
    expect(run([{ type: "draw" }, { type: "concepts", concepts: [] }])).toEqual({ step: "drawing" });
    expect(run([{ type: "draw" }, { type: "concepts", concepts: CONCEPTS }, { type: "pick", conceptId: "zzz" }]).step).toBe("choose");
  });

  it("ignores status for another job and never lowers progress", () => {
    const building = run([...toConfirm, { type: "build" }, { type: "started", jobId: "job-1" }]);
    expect(run([{ type: "status", status: { jobId: "job-2", stage: "rigging", progress: 90 } }], building)).toBe(building);
    const later = run(
      [
        { type: "status", status: { jobId: "job-1", stage: "modeling", progress: 60 } },
        { type: "status", status: { jobId: "job-1", stage: "modeling", progress: 40 } },
      ],
      building,
    );
    expect(later).toMatchObject({ progress: 60 });
  });

  it("returns a refused start to confirm so the user can retry", () => {
    const refused = run([...toConfirm, { type: "build" }, { type: "fail", message: "limit" }]);
    expect(refused).toEqual({ step: "confirm", concepts: CONCEPTS, concept: CONCEPTS[1], error: "limit" });
  });

  it("sends drawing and started-build failures back to the description", () => {
    expect(run([{ type: "draw" }, { type: "fail", message: "blocked" }])).toEqual({ step: "describe", error: "blocked" });
    const failed = run([...toConfirm, { type: "build" }, { type: "started", jobId: "job-1" }, { type: "fail", message: "broke" }]);
    expect(failed).toEqual({ step: "describe", error: "broke" });
  });

  it("resets from any step", () => {
    expect(run([...toConfirm, { type: "reset" }])).toEqual(INITIAL_FLOW);
  });
});

describe("buildingLabel", () => {
  it("names each stage", () => {
    expect(buildingLabel("modeling", 42)).toBe("Sculpting the 3D model… 42%");
    expect(buildingLabel("rigging", 80)).toBe("Adding a skeleton… 80%");
    expect(buildingLabel("ready", 100)).toBe("Downloading your avatar…");
  });
});
