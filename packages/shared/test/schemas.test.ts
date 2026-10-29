import { describe, expect, it } from "vitest";
import {
  AnchorRegion,
  AvatarImage,
  AvatarJobStatus,
  AvatarSpec,
  CritiqueReport,
  CritiqueReportJsonSchema,
  EditCommand,
  EditCommandJsonSchema,
  LookSpec,
  LookSpecJsonSchema,
  WearableSpec,
  WearableSpecJsonSchema,
} from "../src/index.ts";
import invalidCritique from "./fixtures/invalid-critique-report.json";
import invalidEdit from "./fixtures/invalid-edit-command.json";
import invalidLook from "./fixtures/invalid-look-spec.json";
import invalidWearable from "./fixtures/invalid-wearable-spec.json";
import validCritique from "./fixtures/valid-critique-report.json";
import validEdit from "./fixtures/valid-edit-command.json";
import validLook from "./fixtures/valid-look-spec.json";
import validWearable from "./fixtures/valid-wearable-spec.json";

const MAX_DEPTH = 10;

function schemaDepth(node: unknown): number {
  if (node === null || typeof node !== "object") {
    return 0;
  }
  if (Array.isArray(node)) {
    return node.length === 0 ? 1 : 1 + Math.max(...node.map(schemaDepth));
  }
  const record = node as Record<string, unknown>;
  const childDepths: number[] = [0];
  for (const [key, value] of Object.entries(record)) {
    if ((key === "properties" || key === "$defs" || key === "definitions") && isRecord(value)) {
      for (const sub of Object.values(value)) {
        childDepths.push(schemaDepth(sub));
      }
    } else if (["items", "additionalProperties", "contains", "not"].includes(key)) {
      childDepths.push(schemaDepth(value));
    } else if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(key) && Array.isArray(value)) {
      for (const sub of value) {
        childDepths.push(schemaDepth(sub));
      }
    }
  }
  return 1 + Math.max(...childDepths);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsKey(node: unknown, key: string): boolean {
  if (node === null || typeof node !== "object") {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((item) => containsKey(item, key));
  }
  const record = node as Record<string, unknown>;
  return (
    key in record || Object.values(record).some((value) => containsKey(value, key))
  );
}

describe("shared schemas", () => {
  it("accepts the valid fixtures", () => {
    expect(LookSpec.safeParse(validLook).success).toBe(true);
    expect(WearableSpec.safeParse(validWearable).success).toBe(true);
    expect(EditCommand.safeParse(validEdit).success).toBe(true);
    expect(CritiqueReport.safeParse(validCritique).success).toBe(true);
  });

  it("rejects the invalid fixtures", () => {
    expect(LookSpec.safeParse(invalidLook).success).toBe(false);
    expect(WearableSpec.safeParse(invalidWearable).success).toBe(false);
    expect(EditCommand.safeParse(invalidEdit).success).toBe(false);
    expect(CritiqueReport.safeParse(invalidCritique).success).toBe(false);
  });

  it("supports floating and screen anchor regions", () => {
    expect(AnchorRegion.safeParse("floating").success).toBe(true);
    expect(AnchorRegion.safeParse("screen").success).toBe(true);
    for (const region of ["floating", "screen"] as const) {
      const parsed = WearableSpec.safeParse({
        id: `w-${region}`,
        type: "custom",
        label: `${region} item`,
        anchor: { region },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("validates optional makeup layers", () => {
    const base = { ...validLook, makeup: undefined };
    expect(LookSpec.safeParse(base).success).toBe(true);
    expect(LookSpec.safeParse({ ...base, makeup: { blush: { color: "#ff8a80", opacity: 0.3 } } }).success).toBe(true);
    for (const lips of [
      { color: "red", opacity: 0.5, finish: "matte" },
      { color: "#c2185b", opacity: 1.5, finish: "matte" },
      { color: "#c2185b", opacity: 0.5, finish: "glitter" },
    ]) {
      expect(LookSpec.safeParse({ ...base, makeup: { lips } }).success).toBe(false);
    }
  });

  it("exports flat, non-recursive JSON Schemas", () => {
    const schemas = {
      LookSpecJsonSchema,
      WearableSpecJsonSchema,
      EditCommandJsonSchema,
      CritiqueReportJsonSchema,
    };
    for (const [name, schema] of Object.entries(schemas)) {
      expect(isRecord(schema), `${name} is an object`).toBe(true);
      expect(schema, `${name} round-trips through JSON`).toEqual(
        JSON.parse(JSON.stringify(schema)),
      );
      expect((schema as Record<string, unknown>).type, `${name} is an object schema`).toBe(
        "object",
      );
      expect(schemaDepth(schema), `${name} depth`).toBeLessThanOrEqual(MAX_DEPTH);
      expect(containsKey(schema, "$recursiveRef"), `${name} has no recursive refs`).toBe(false);
      expect(containsKey(schema, "$recursiveAnchor"), `${name} has no recursive anchors`).toBe(
        false,
      );
    }
  });
});

describe("avatar schemas", () => {
  it("accepts only inline images and bounded job statuses", () => {
    expect(AvatarImage.safeParse("data:image/webp;base64,UklGR=").success).toBe(true);
    expect(AvatarImage.safeParse("https://example.com/me.png").success).toBe(false);
    expect(AvatarJobStatus.safeParse({ jobId: "a", stage: "rigging", progress: 80 }).success).toBe(true);
    expect(AvatarJobStatus.safeParse({ jobId: "a", stage: "rigging", progress: 101 }).success).toBe(false);
    expect(AvatarSpec.safeParse({ id: "a", description: "x".repeat(501), conceptId: "c" }).success).toBe(false);
  });
});
