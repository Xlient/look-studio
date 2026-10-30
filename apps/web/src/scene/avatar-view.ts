import { AmbientLight, Bone, Box3, Color, DirectionalLight, Euler, Mesh, PerspectiveCamera, Quaternion, Scene, Texture, Vector3 } from "three";
import type { Group, Material, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createRigPose, findRigBones, writeRigPose } from "./avatar-rig.ts";
import type { AvatarMotion, BoneTurn } from "./avatar-rig.ts";
import type { FaceRig } from "./avatar-face-rig.ts";

const BACKGROUND = 0xdfe7ff;
const FOV_DEG = 30;
const BUST_SHARE = 0.42;
const HEAD_ROOM = 0.05;

export interface AvatarView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly model: Object3D;
  readonly head: Object3D | null;
  setFaceRig(rig: FaceRig): void;
  resize(width: number, height: number): void;
  pose(motion: AvatarMotion, expressions: Float32Array, timeS: number): void;
  dispose(): void;
}

interface DrivenBone {
  bone: Object3D;
  rest: Quaternion;
}

function frameBust(model: Group, camera: PerspectiveCamera) {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) {
    camera.position.set(0, 1.5, 2);
    camera.lookAt(0, 1.5, 0);
    return;
  }
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const visible = size.y * BUST_SHARE;
  const targetY = box.max.y + size.y * HEAD_ROOM - visible / 2;
  const distance = visible / 2 / Math.tan((FOV_DEG * Math.PI) / 360) + size.z / 2;
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 10;
  camera.position.set(center.x, targetY, center.z + distance);
  camera.lookAt(center.x, targetY, center.z);
}

function disposeMaterial(material: Material) {
  const values: unknown[] = Object.values(material);
  for (const value of values) {
    if (value instanceof Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

export async function loadAvatarView(data: ArrayBuffer): Promise<AvatarView> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  const model = gltf.scene;
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(0.5, 1, 1.5);
  scene.add(model, new AmbientLight(0xffffff, 1.1), key);

  const bones: Object3D[] = [];
  model.traverse((object: Object3D) => {
    if (object instanceof Bone) {
      bones.push(object);
    }
    // Skinned meshes keep their bind-pose bounds, so a turned head could be culled.
    if (object instanceof Mesh) {
      object.frustumCulled = false;
    }
  });
  const found = findRigBones(bones.map((bone) => bone.name));
  const drive = (index: number | null): DrivenBone | null => {
    const bone = index === null ? undefined : bones[index];
    return bone === undefined ? null : { bone, rest: bone.quaternion.clone() };
  };
  const head = drive(found.head);
  const neck = drive(found.neck);
  const spine = drive(found.spine);

  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.01, 100);
  frameBust(model, camera);

  const rig = createRigPose();
  let faceRig: FaceRig | null = null;
  const euler = new Euler();
  const delta = new Quaternion();
  const parentWorld = new Quaternion();
  const next = new Quaternion();

  // Turns are in world space, so convert through the parent's current world rotation before applying to the local rest pose.
  const turn = (driven: DrivenBone | null, by: BoneTurn) => {
    if (driven === null) {
      return;
    }
    delta.setFromEuler(euler.set(by.pitch, by.yaw, by.roll, "YXZ"));
    const parent = driven.bone.parent;
    if (parent === null) {
      next.copy(delta);
    } else {
      parent.getWorldQuaternion(parentWorld);
      next.copy(parentWorld).invert().multiply(delta).multiply(parentWorld);
    }
    driven.bone.quaternion.copy(next.multiply(driven.rest));
  };

  return {
    scene,
    camera,
    model,
    head: head?.bone ?? null,
    setFaceRig(next) {
      faceRig = next;
    },
    resize(width, height) {
      camera.aspect = height > 0 ? width / height : 1;
      camera.updateProjectionMatrix();
    },
    pose(motion, expressions, timeS) {
      faceRig?.apply(expressions);
      writeRigPose(rig, motion, timeS);
      if (head === null) {
        rig.neck.yaw += rig.head.yaw;
        rig.neck.pitch += rig.head.pitch;
        rig.neck.roll += rig.head.roll;
      }
      turn(spine, rig.spine);
      turn(neck, rig.neck);
      turn(head, rig.head);
    },
    dispose() {
      model.traverse((object: Object3D) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
    },
  };
}
