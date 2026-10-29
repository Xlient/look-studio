import { MakeupArea } from "@look-studio/shared";
import type { EditCommand, LookSpec, Makeup, WearableSpec } from "@look-studio/shared";

const MAX_WEARABLES = 20;
export const MAX_OFFSET = 2;
export const SCALE_RANGE = { min: 0.1, max: 5 } as const;

function clampOffset(value: number): number {
  return Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, value));
}

function updateWearable(look: LookSpec, id: string, update: (wearable: WearableSpec) => WearableSpec): LookSpec {
  return { ...look, wearables: look.wearables.map((wearable) => (wearable.id === id ? update(wearable) : wearable)) };
}

function withMakeup(look: LookSpec, makeup: Makeup): LookSpec {
  if (Object.keys(makeup).length > 0) {
    return { ...look, makeup };
  }
  const copy = { ...look };
  delete copy.makeup;
  return copy;
}

function applyMakeup(look: LookSpec, command: EditCommand): LookSpec {
  const area = MakeupArea.safeParse(command.targetId);
  if (!area.success) {
    return look;
  }
  const makeup: Makeup = { ...look.makeup };
  const current = makeup[area.data];
  const color = command.color ?? current?.color;
  const opacity = command.opacity ?? current?.opacity;
  if (opacity === 0) {
    delete makeup[area.data];
    return withMakeup(look, makeup);
  }
  if (color === undefined || opacity === undefined) {
    return look;
  }
  switch (area.data) {
    case "lips":
      makeup.lips = { color, opacity, finish: makeup.lips?.finish ?? "satin" };
      break;
    case "eyeshadow":
      makeup.eyeshadow = { color, opacity, finish: makeup.eyeshadow?.finish ?? "matte" };
      break;
    case "blush":
    case "brows":
      makeup[area.data] = { color, opacity };
      break;
  }
  return withMakeup(look, makeup);
}

export function applyEdit(look: LookSpec, command: EditCommand): LookSpec {
  switch (command.op) {
    case "add":
      return command.wearable === undefined || look.wearables.length >= MAX_WEARABLES
        ? look
        : { ...look, wearables: [...look.wearables, command.wearable] };
    case "remove":
      return { ...look, wearables: look.wearables.filter((wearable) => wearable.id !== command.targetId) };
    case "toggle":
      return updateWearable(look, command.targetId, (wearable) => ({
        ...wearable,
        visible: !(wearable.visible ?? true),
      }));
    case "move": {
      const delta = command.delta;
      if (delta === undefined) {
        return look;
      }
      return updateWearable(look, command.targetId, (wearable) => {
        const offset = wearable.anchor.offset ?? { x: 0, y: 0, z: 0 };
        return {
          ...wearable,
          anchor: {
            ...wearable.anchor,
            offset: {
              x: clampOffset(offset.x + delta.x),
              y: clampOffset(offset.y + delta.y),
              z: clampOffset(offset.z + delta.z),
            },
          },
        };
      });
    }
    case "scale": {
      const factor = command.factor;
      if (factor === undefined) {
        return look;
      }
      return updateWearable(look, command.targetId, (wearable) => ({
        ...wearable,
        scale: Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, (wearable.scale ?? 1) * factor)),
      }));
    }
    case "recolor": {
      const color = command.color;
      if (color === undefined) {
        return look;
      }
      const palette = [color, ...(look.palette ?? []).filter((entry) => entry !== color)].slice(0, 8);
      return { ...look, palette };
    }
    case "makeup":
      return applyMakeup(look, command);
  }
}

function labelFor(look: LookSpec, id: string): string {
  return look.wearables.find((wearable) => wearable.id === id)?.label ?? "that item";
}

function describeMove(delta: { x: number; y: number; z: number }): string {
  const axes: [number, string, string][] = [
    [delta.y, "up", "down"],
    [delta.x, "right", "left"],
    [delta.z, "closer", "back"],
  ];
  const words = axes.filter(([value]) => Math.abs(value) >= 0.01).map(([value, pos, neg]) => (value > 0 ? pos : neg));
  return words.length === 0 ? "a touch" : words.join(" and ");
}

function describeMakeup(command: EditCommand): string {
  if (command.opacity === 0) {
    return `Took off the ${command.targetId} colour.`;
  }
  return command.color === undefined
    ? `Adjusted the ${command.targetId}.`
    : `Changed ${command.targetId} to ${command.color}.`;
}

export function describeEdit(before: LookSpec, command: EditCommand): string {
  if (command.op === "makeup") {
    return describeMakeup(command);
  }
  const label = command.op === "add" ? command.wearable?.label ?? "a new item" : labelFor(before, command.targetId);
  switch (command.op) {
    case "add":
      return `Added ${label}.`;
    case "remove":
      return `Removed ${label}.`;
    case "toggle": {
      const visible = before.wearables.find((wearable) => wearable.id === command.targetId)?.visible ?? true;
      return visible ? `Hid ${label}.` : `Brought back ${label}.`;
    }
    case "move":
      return `Moved ${label} ${describeMove(command.delta ?? { x: 0, y: 0, z: 0 })}.`;
    case "scale":
      return (command.factor ?? 1) >= 1 ? `Made ${label} bigger.` : `Made ${label} smaller.`;
    case "recolor":
      return `Switched ${label} to ${command.color ?? "a new colour"}.`;
  }
}
