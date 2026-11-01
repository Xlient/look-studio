import type { LookSpec } from "../../packages/shared/src/index.ts";

export const EDIT_LOOKS = {
  "crown-glam": {
    id: "look-crown-glam",
    name: "Crown glam",
    style: "formal",
    wearables: [
      { id: "w-crown", type: "hat", label: "Gold crown", anchor: { region: "head" }, color: "#D4AF37" },
      { id: "w-glasses", type: "glasses", label: "Heart glasses", anchor: { region: "face" }, color: "#FF4D8D" },
    ],
    makeup: {
      lips: { color: "#C2185B", opacity: 0.5, finish: "satin" },
      blush: { color: "#F08080", opacity: 0.3 },
      eyeshadow: { color: "#8E7CC3", opacity: 0.3, finish: "shimmer" },
      brows: { color: "#4A3728", opacity: 0.4 },
    },
  },
  "two-hats": {
    id: "look-two-hats",
    name: "Two hats",
    style: "street",
    wearables: [
      { id: "w-cap", type: "hat", label: "Red cap", anchor: { region: "head" }, color: "#D32F2F" },
      { id: "w-beanie", type: "hat", label: "Blue beanie", anchor: { region: "head" }, color: "#1E88E5" },
    ],
    makeup: { lips: { color: "#B5655D", opacity: 0.4, finish: "matte" } },
  },
  bare: { id: "look-bare", name: "Bare", style: "casual", wearables: [] },
} satisfies Record<string, LookSpec>;

export type EditLookName = keyof typeof EDIT_LOOKS;

export const EDIT_LOOK_NAMES = Object.keys(EDIT_LOOKS) as [EditLookName, ...EditLookName[]];
