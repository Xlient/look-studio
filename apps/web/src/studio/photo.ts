export const MAX_PHOTO_BYTES = 3_000_000;
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type PhotoProblem = "type" | "size" | null;

export function checkPhoto(file: { type: string; size: number }): PhotoProblem {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return "type";
  }
  return file.size > MAX_PHOTO_BYTES ? "size" : null;
}

export function photoProblemMessage(problem: Exclude<PhotoProblem, null>): string {
  return problem === "type" ? "Use a PNG, JPEG, or WebP photo." : "That photo is over 3 MB. Try a smaller one.";
}

export function readPhoto(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("photo_unreadable"));
    reader.onerror = () => reject(new Error("photo_unreadable"));
    reader.readAsDataURL(file);
  });
}
