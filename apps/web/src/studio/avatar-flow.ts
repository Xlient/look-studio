import type { AvatarConcept, AvatarJobStatus, AvatarStage } from "@look-studio/shared";

export const BUILD_NOTE =
  "Meshy turns this concept into a rigged 3D model. It takes about 3 to 6 minutes and uses one of your daily avatar builds.";

export type AvatarFlow =
  | { step: "describe"; error: string | null }
  | { step: "drawing" }
  | { step: "choose"; concepts: AvatarConcept[] }
  | { step: "confirm"; concepts: AvatarConcept[]; concept: AvatarConcept; error: string | null }
  | { step: "building"; concepts: AvatarConcept[]; concept: AvatarConcept; jobId: string | null; stage: AvatarStage; progress: number }
  | { step: "ready"; concept: AvatarConcept };

export type AvatarFlowEvent =
  | { type: "draw" }
  | { type: "concepts"; concepts: AvatarConcept[] }
  | { type: "pick"; conceptId: string }
  | { type: "back" }
  | { type: "build" }
  | { type: "started"; jobId: string }
  | { type: "status"; status: AvatarJobStatus }
  | { type: "loaded" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const INITIAL_FLOW: AvatarFlow = { step: "describe", error: null };

function fail(flow: AvatarFlow, message: string): AvatarFlow {
  if (flow.step === "building" && flow.jobId === null) {
    return { step: "confirm", concepts: flow.concepts, concept: flow.concept, error: message };
  }
  return flow.step === "drawing" || flow.step === "building" ? { step: "describe", error: message } : flow;
}

export function avatarFlowReducer(flow: AvatarFlow, event: AvatarFlowEvent): AvatarFlow {
  switch (event.type) {
    case "draw":
      return flow.step === "describe" ? { step: "drawing" } : flow;
    case "concepts":
      return flow.step === "drawing" && event.concepts.length > 0 ? { step: "choose", concepts: event.concepts } : flow;
    case "pick": {
      if (flow.step !== "choose") {
        return flow;
      }
      const concept = flow.concepts.find((candidate) => candidate.id === event.conceptId);
      return concept === undefined ? flow : { step: "confirm", concepts: flow.concepts, concept, error: null };
    }
    case "back":
      return flow.step === "confirm" ? { step: "choose", concepts: flow.concepts } : flow;
    case "build":
      return flow.step === "confirm"
        ? { step: "building", concepts: flow.concepts, concept: flow.concept, jobId: null, stage: "queued", progress: 0 }
        : flow;
    case "started":
      return flow.step === "building" && flow.jobId === null ? { ...flow, jobId: event.jobId } : flow;
    case "status":
      return flow.step === "building" && flow.jobId === event.status.jobId
        ? { ...flow, stage: event.status.stage, progress: Math.max(flow.progress, event.status.progress) }
        : flow;
    case "loaded":
      return flow.step === "building" ? { step: "ready", concept: flow.concept } : flow;
    case "fail":
      return fail(flow, event.message);
    case "reset":
      return INITIAL_FLOW;
  }
}

export function buildingLabel(stage: AvatarStage, progress: number): string {
  switch (stage) {
    case "queued":
      return "Waiting for Meshy…";
    case "modeling":
      return `Sculpting the 3D model… ${progress}%`;
    case "rigging":
      return `Adding a skeleton… ${progress}%`;
    case "ready":
      return "Downloading your avatar…";
    case "failed":
      return "The build stopped.";
  }
}
