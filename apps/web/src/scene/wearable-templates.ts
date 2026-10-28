import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { DEFAULT_GLASSES_COLOR, DEFAULT_HEAD_COLOR } from "./wearable-layout.ts";

// Units are outer-eye-corner spans; the scene scales each template by that span in pixels.
const CROWN_POINTS = 5;
const CROWN_RADIUS = 0.75;
const HEAD_TILT = 0.2;

export interface WearableTemplate {
  readonly group: Group;
  readonly tint: MeshStandardMaterial;
}

export function buildCrown(): WearableTemplate {
  const tint = new MeshStandardMaterial({ color: DEFAULT_HEAD_COLOR, metalness: 0.5, roughness: 0.35, side: DoubleSide });
  const gem = new MeshStandardMaterial({ color: 0xff3fa4, emissive: 0x5a0030, metalness: 0.2, roughness: 0.1 });
  const group = new Group();
  group.rotation.x = HEAD_TILT;
  group.add(new Mesh(new CylinderGeometry(CROWN_RADIUS, CROWN_RADIUS * 0.95, 0.32, 32, 1, true), tint));
  for (let i = 0; i < CROWN_POINTS; i += 1) {
    const angle = (i / CROWN_POINTS) * Math.PI * 2;
    const x = Math.sin(angle) * CROWN_RADIUS;
    const z = Math.cos(angle) * CROWN_RADIUS;
    const spike = new Mesh(new ConeGeometry(0.17, 0.42, 4), tint);
    spike.position.set(x, 0.37, z);
    const jewel = new Mesh(new SphereGeometry(0.07, 12, 8), gem);
    jewel.position.set(x, 0.6, z);
    group.add(spike, jewel);
  }
  return { group, tint };
}

export function buildHat(): WearableTemplate {
  const tint = new MeshStandardMaterial({ color: DEFAULT_HEAD_COLOR, metalness: 0.05, roughness: 0.8, side: DoubleSide });
  const band = new MeshStandardMaterial({ color: 0x1f1b24, metalness: 0.1, roughness: 0.6 });
  const group = new Group();
  group.rotation.x = HEAD_TILT;
  const brim = new Mesh(new CylinderGeometry(1.15, 1.15, 0.05, 40), tint);
  const crown = new Mesh(new CylinderGeometry(0.62, 0.7, 0.7, 40), tint);
  crown.position.set(0, 0.37, 0);
  const ribbon = new Mesh(new CylinderGeometry(0.71, 0.71, 0.14, 40, 1, true), band);
  ribbon.position.set(0, 0.1, 0);
  group.add(brim, crown, ribbon);
  return { group, tint };
}

export function buildGlasses(): WearableTemplate {
  const tint = new MeshStandardMaterial({ color: DEFAULT_GLASSES_COLOR, metalness: 0.4, roughness: 0.35 });
  const group = new Group();
  for (const side of [-1, 1]) {
    const rim = new Mesh(new TorusGeometry(0.21, 0.035, 12, 40), tint);
    rim.position.set(side * 0.33, 0, 0.1);
    const arm = new Mesh(new BoxGeometry(0.035, 0.035, 0.3), tint);
    arm.position.set(side * 0.55, 0.04, -0.05);
    group.add(rim, arm);
  }
  const bridge = new Mesh(new CylinderGeometry(0.022, 0.022, 0.25, 12), tint);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.set(0, 0.04, 0.1);
  group.add(bridge);
  return { group, tint };
}
