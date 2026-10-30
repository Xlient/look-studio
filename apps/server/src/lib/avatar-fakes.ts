import type { AvatarBuild, AvatarModelProvider, BuildStage } from "./meshy-avatar.ts";
import type { ConceptRequest, ConceptService } from "./muse-image.ts";

const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function emptyGlb(): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }));
  const padded = Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + padded);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20);
  out.set(json, 20);
  return out;
}

export class FakeConceptService implements ConceptService {
  async createConcepts(request: ConceptRequest): Promise<string[]> {
    void request;
    return [1, 2, 3].map(() => `data:image/png;base64,${PIXEL_PNG}`);
  }
}

export class FakeAvatarProvider implements AvatarModelProvider {
  async build(
    image: string,
    description: string,
    signal: AbortSignal,
    onProgress: (stage: BuildStage, progress: number) => void,
  ): Promise<AvatarBuild> {
    void image;
    void description;
    void signal;
    onProgress("modeling", 50);
    onProgress("rigging", 50);
    return {
      glbUrl: `data:model/gltf-binary;base64,${Buffer.from(emptyGlb()).toString("base64")}`,
      cleanup: async () => {},
    };
  }
}
