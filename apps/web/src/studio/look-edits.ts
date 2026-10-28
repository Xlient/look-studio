import type { EditCommand, LookSpec, WearableSpec } from "@look-studio/shared";

const MAX_WEARABLES = 20;
export const MAX_OFFSET = 2;
export const SCALE_RANGE = { min: 0.1, max: 5 } as const;

function clampOffset(value: number): number {
  return Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, value));
}

function updateWearable(look: LookSpec, id: string, update: (wearable: WearableSpec) => WearableSpec): LookSpec {
  return { ...look, wearables: look.wearables.map((wearable) => (wearable.id === id ? update(wearable) : wearable)) };
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

export function describeEdit(before: LookSpec, command: EditCommand): string {
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
