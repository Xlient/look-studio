import { createSpring, stepSpring } from "./spring.ts";
import type { Spring, SpringParams } from "./spring.ts";

export const HEAD_LIMITS = { yaw: 0.7, pitch: 0.5, roll: 0.5 } as const;
export const NECK_SHARE = 0.4;
export const SPINE_YAW_SHARE = 0.15;
export const BREATH_HZ = 0.25;
export const BREATH_RAD = 0.015;
const MOTION_SPRING: SpringParams = { stiffness: 120, damping: 22 };

export interface RigBones {
  head: number | null;
  neck: number | null;
  spine: number | null;
}

export interface HeadAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface AvatarMotion {
  yaw: Spring;
  pitch: Spring;
  roll: Spring;
}

export interface BoneTurn {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface RigPose {
  head: BoneTurn;
  neck: BoneTurn;
  spine: BoneTurn;
}

const normalize = (name: string) => name.toLowerCase().replace(/^.*[:|]/, "").replace(/[^a-z0-9]/g, "");

// Rig exporters disagree on names (mixamorig:Head, Head, head_01, Spine02), so match loosely after stripping prefixes.
function firstMatch(names: string[], test: (name: string) => boolean): number | null {
  const index = names.findIndex((name) => test(normalize(name)));
  return index === -1 ? null : index;
}

export function findRigBones(names: string[]): RigBones {
  const spines = names
    .map((name, index) => ({ name: normalize(name), index }))
    .filter(({ name }) => /^(spine|chest|upperchest)\d*$/.test(name));
  return {
    head: firstMatch(names, (name) => /^head\d*$/.test(name)),
    neck: firstMatch(names, (name) => /^neck\d*$/.test(name)),
    spine: spines.length === 0 ? null : (spines[spines.length - 1]?.index ?? null),
  };
}

const clamp = (value: number, limit: number) => (Number.isFinite(value) ? Math.min(limit, Math.max(-limit, value)) : 0);

// YXZ Euler from the column-major face transform; mirroring reflects across x, which flips yaw and roll.
export function headAngles(out: HeadAngles, pose: ArrayLike<number>, mirror: boolean): HeadAngles {
  const m13 = pose[8] ?? 0;
  const m21 = pose[1] ?? 0;
  const m22 = pose[5] ?? 1;
  const m23 = pose[9] ?? 0;
  const m33 = pose[10] ?? 1;
  const pitch = Math.asin(Math.min(1, Math.max(-1, -m23)));
  const yaw = Math.atan2(m13, m33);
  const roll = Math.atan2(m21, m22);
  const flip = mirror ? -1 : 1;
  out.yaw = clamp(flip * yaw, HEAD_LIMITS.yaw);
  out.pitch = clamp(pitch, HEAD_LIMITS.pitch);
  out.roll = clamp(flip * roll, HEAD_LIMITS.roll);
  return out;
}

export function createAvatarMotion(): AvatarMotion {
  return { yaw: createSpring(), pitch: createSpring(), roll: createSpring() };
}

export function stepAvatarMotion(motion: AvatarMotion, target: HeadAngles | null, dtS: number): AvatarMotion {
  stepSpring(motion.yaw, target?.yaw ?? 0, MOTION_SPRING, dtS);
  stepSpring(motion.pitch, target?.pitch ?? 0, MOTION_SPRING, dtS);
  stepSpring(motion.roll, target?.roll ?? 0, MOTION_SPRING, dtS);
  return motion;
}

export function breathPitch(timeS: number): number {
  return Number.isFinite(timeS) ? Math.sin(2 * Math.PI * BREATH_HZ * timeS) * BREATH_RAD : 0;
}

export function writeRigPose(out: RigPose, motion: AvatarMotion, timeS: number): RigPose {
  const yaw = motion.yaw.position;
  const pitch = motion.pitch.position;
  const roll = motion.roll.position;
  const spineYaw = yaw * SPINE_YAW_SHARE;
  out.spine.yaw = spineYaw;
  out.spine.pitch = breathPitch(timeS);
  out.spine.roll = 0;
  out.neck.yaw = (yaw - spineYaw) * NECK_SHARE;
  out.neck.pitch = pitch * NECK_SHARE;
  out.neck.roll = roll * NECK_SHARE;
  out.head.yaw = yaw - spineYaw - out.neck.yaw;
  out.head.pitch = pitch - out.neck.pitch;
  out.head.roll = roll - out.neck.roll;
  return out;
}

export function createRigPose(): RigPose {
  return { head: { yaw: 0, pitch: 0, roll: 0 }, neck: { yaw: 0, pitch: 0, roll: 0 }, spine: { yaw: 0, pitch: 0, roll: 0 } };
}
