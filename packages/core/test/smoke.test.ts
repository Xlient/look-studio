import { describe, expect, it } from "vitest";
import * as core from "../src/index.ts";

describe("core smoke", () => {
  it("resolves the user-owned package", () => {
    expect(typeof core).toBe("object");
  });
});
