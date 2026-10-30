import { describe, expect, it } from "vitest";
import {
  BREATH_HZ,
  BREATH_RAD,
  HEAD_LIMITS,
  breathPitch,
  createAvatarMotion,
  createRigPose,
  findRigBones,
  headAngles,
  stepAvatarMotion,
  writeRigPose,
} from "../src/scene/avatar-rig.ts";

function rotationY(angle: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = Math.cos(angle);
  m[8] = Math.sin(angle);
  m[2] = -Math.sin(angle);
  m[10] = Math.cos(angle);
  m[5] = 1;
  m[15] = 1;
  return m;
}

function rotationX(angle: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = Math.cos(angle);
  m[9] = -Math.sin(angle);
  m[6] = Math.sin(angle);
  m[10] = Math.cos(angle);
  m[15] = 1;
  return m;
}

function rotationZ(angle: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = Math.cos(angle);
  m[4] = -Math.sin(angle);
  m[1] = Math.sin(angle);
  m[5] = Math.cos(angle);
  m[10] = 1;
  m[15] = 1;
  return m;
}

const angles = () => ({ yaw: 0, pitch: 0, roll: 0 });

describe("findRigBones", () => {
  it("matches prefixed and numbered names and picks the upper spine", () => {
    const names = ["Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:Neck", "mixamorig:Head", "mixamorig:HeadTop_End"];
    expect(findRigBones(names)).toEqual({ spine: 3, neck: 4, head: 5 });
  });

  it("handles other casings and missing bones", () => {
    expect(findRigBones(["root", "spine_01", "neck_01", "head"])).toEqual({ spine: 1, neck: 2, head: 3 });
    expect(findRigBones(["Armature", "LeftArm", "Headset"])).toEqual({ spine: null, neck: null, head: null });
  });
});

describe("headAngles", () => {
  it("reads yaw, pitch and roll from the face transform", () => {
    expect(headAngles(angles(), rotationY(0.3), false).yaw).toBeCloseTo(0.3);
    expect(headAngles(angles(), rotationX(0.2), false).pitch).toBeCloseTo(0.2);
    expect(headAngles(angles(), rotationZ(-0.25), false).roll).toBeCloseTo(-0.25);
  });

  it("flips yaw and roll, but not pitch, when mirrored", () => {
    expect(headAngles(angles(), rotationY(0.3), true).yaw).toBeCloseTo(-0.3);
    expect(headAngles(angles(), rotationZ(0.25), true).roll).toBeCloseTo(-0.25);
    expect(headAngles(angles(), rotationX(0.2), true).pitch).toBeCloseTo(0.2);
  });

  it("clamps extreme turns and survives garbage", () => {
    expect(headAngles(angles(), rotationY(1.4), false).yaw).toBe(HEAD_LIMITS.yaw);
    expect(headAngles(angles(), new Float32Array(16).fill(Number.NaN), false)).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });
});

describe("stepAvatarMotion", () => {
  it("settles on the target and eases home when the face is lost", () => {
    const motion = createAvatarMotion();
    for (let i = 0; i < 120; i += 1) {
      stepAvatarMotion(motion, { yaw: 0.4, pitch: -0.2, roll: 0.1 }, 1 / 30);
    }
    expect(motion.yaw.position).toBeCloseTo(0.4, 3);
    expect(motion.pitch.position).toBeCloseTo(-0.2, 3);
    for (let i = 0; i < 120; i += 1) {
      stepAvatarMotion(motion, null, 1 / 30);
    }
    expect(motion.yaw.position).toBeCloseTo(0, 3);
  });

  it("does not overshoot far past the target", () => {
    const motion = createAvatarMotion();
    let peak = 0;
    for (let i = 0; i < 60; i += 1) {
      peak = Math.max(peak, stepAvatarMotion(motion, { yaw: 0.5, pitch: 0, roll: 0 }, 1 / 30).yaw.position);
    }
    expect(peak).toBeLessThan(0.52);
  });
});

describe("writeRigPose", () => {
  it("splits the turn across spine, neck and head so the parts add up", () => {
    const motion = createAvatarMotion();
    motion.yaw.position = 0.5;
    motion.pitch.position = 0.2;
    motion.roll.position = -0.1;
    const pose = writeRigPose(createRigPose(), motion, 0);
    expect(pose.spine.yaw + pose.neck.yaw + pose.head.yaw).toBeCloseTo(0.5);
    expect(pose.neck.pitch + pose.head.pitch).toBeCloseTo(0.2);
    expect(pose.neck.roll + pose.head.roll).toBeCloseTo(-0.1);
    expect(Math.abs(pose.head.yaw)).toBeGreaterThan(Math.abs(pose.neck.yaw));
  });

  it("breathes through the spine", () => {
    expect(breathPitch(1 / (4 * BREATH_HZ))).toBeCloseTo(BREATH_RAD);
    expect(breathPitch(Number.NaN)).toBe(0);
    expect(writeRigPose(createRigPose(), createAvatarMotion(), 1 / (4 * BREATH_HZ)).spine.pitch).toBeCloseTo(BREATH_RAD);
  });
});
