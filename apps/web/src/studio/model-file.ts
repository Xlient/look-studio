import { MAX_MODEL_BYTES } from "./avatar-client.ts";

export type ModelFileProblem = "type" | "size";

export const MODEL_FILE_TYPES = [".vrm", ".glb"] as const;

export function checkModelFile(file: { name: string; size: number }): ModelFileProblem | null {
  const name = file.name.toLowerCase();
  if (!MODEL_FILE_TYPES.some((ending) => name.endsWith(ending))) {
    return "type";
  }
  return file.size > 0 && file.size <= MAX_MODEL_BYTES ? null : "size";
}

export function modelFileMessage(problem: ModelFileProblem): string {
  return problem === "type" ? "Choose a .vrm or .glb avatar file." : "That file is empty or larger than 60 MB.";
}
