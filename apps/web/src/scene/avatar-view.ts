import { AmbientLight, Bone, Box3, Color, DirectionalLight, Euler, Mesh, PerspectiveCamera, Quaternion, Scene, Texture, Vector3 } from "three";
import type { Group, Material, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRM_EXPRESSIONS, writeVrmWeights } from "./vrm-expressions.ts";
import { frameBust } from "./avatar-framing.ts";
import type { CameraFrame, FrameMode } from "./avatar-framing.ts";
import { headBounds, readHeadSurface } from "./avatar-face-rig.ts";
import { createRigPose, findRigBones, writeRigPose } from "./avatar-rig.ts";
import type { AvatarMotion, BoneTurn } from "./avatar-rig.ts";
import type { FaceRig } from "./avatar-face-rig.ts";

const BACKGROUND = 0xdfe7ff;
const FOV_DEG = 30;

export interface AvatarView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly model: Object3D;
  readonly kind: "vrm" | "glb";
  readonly head: Object3D | null;
  readonly meshCount: number;
  readonly boneCount: number;
  readonly frameMode: FrameMode | null;
  onFirstFrame(listener: () => void): void;
  setFaceRig(rig: FaceRig): void;
  resize(width: number, height: number): void;
  pose(motion: AvatarMotion, expressions: Float32Array, timeS: number): void;
  dispose(): void;
}

interface DrivenBone {
  bone: Object3D;
  rest: Quaternion;
}

function frameCamera(model: Group, head: Object3D | null, camera: PerspectiveCamera): CameraFrame | null {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) {
    camera.position.set(0, 1.5, 2);
    camera.lookAt(0, 1.5, 0);
    return null;
  }
  const surface = head === null ? null : readHeadSurface(model, head);
  const headBox = surface === null ? null : headBounds(surface);
  const frame = frameBust(
    { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z },
    headBox,
    FOV_DEG,
  );
  camera.near = frame.near;
  camera.far = frame.far;
  camera.position.set(frame.x, frame.y, frame.z);
  camera.lookAt(frame.x, frame.lookY, frame.lookZ);
  return frame;
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
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(data, "");
  const vrm = gltf.userData["vrm"] instanceof VRM ? gltf.userData["vrm"] : null;
  if (vrm !== null) {
    VRMUtils.rotateVRM0(vrm);
  }
  const model = vrm?.scene ?? gltf.scene;
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(0.5, 1, 1.5);
  scene.add(model, new AmbientLight(0xffffff, 1.1), key);

  const bones: Object3D[] = [];
  let meshCount = 0;
  model.traverse((object: Object3D) => {
    if (object instanceof Bone) {
      bones.push(object);
    }
    // Skinned meshes keep their bind-pose bounds, so a turned head could be culled.
    if (object instanceof Mesh) {
      meshCount += 1;
      object.frustumCulled = false;
    }
  });
  const found = findRigBones(bones.map((bone) => bone.name));
  const drive = (index: number | null): DrivenBone | null => {
    const bone = index === null ? undefined : bones[index];
    return bone === undefined ? null : { bone, rest: bone.quaternion.clone() };
  };
  // VRM poses its normalized bones and copies them onto the raw skeleton in update().
  const node = (name: "head" | "neck" | "spine"): DrivenBone | null => {
    const bone = vrm?.humanoid.getNormalizedBoneNode(name) ?? null;
    return bone === null ? null : { bone, rest: bone.quaternion.clone() };
  };
  const head = vrm === null ? drive(found.head) : node("head");
  const neck = vrm === null ? drive(found.neck) : node("neck");
  const spine = vrm === null ? drive(found.spine) : node("spine");
  const vrmWeights = new Float32Array(VRM_EXPRESSIONS.length);
  let lastPoseS: number | null = null;

  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.01, 100);
  const frame = frameCamera(model, vrm === null ? (head?.bone ?? null) : vrm.humanoid.getRawBoneNode("head"), camera);

  const rig = createRigPose();
  let faceRig: FaceRig | null = null;
  let firstFrame: (() => void) | null = null;
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
    kind: vrm === null ? "glb" : "vrm",
    head: head?.bone ?? null,
    meshCount,
    boneCount: bones.length,
    frameMode: frame?.mode ?? null,
    onFirstFrame(listener) {
      firstFrame = listener;
    },
    setFaceRig(next) {
      faceRig = next;
    },
    resize(width, height) {
      camera.aspect = height > 0 ? width / height : 1;
      camera.updateProjectionMatrix();
    },
    pose(motion, expressions, timeS) {
      if (firstFrame !== null) {
        const listener = firstFrame;
        firstFrame = null;
        listener();
      }
      if (vrm === null) {
        faceRig?.apply(expressions);
      } else {
        writeVrmWeights(vrmWeights, expressions);
        VRM_EXPRESSIONS.forEach((name, index) => vrm.expressionManager?.setValue(name, vrmWeights[index] ?? 0));
      }
      writeRigPose(rig, motion, timeS);
      if (head === null) {
        rig.neck.yaw += rig.head.yaw;
        rig.neck.pitch += rig.head.pitch;
        rig.neck.roll += rig.head.roll;
      }
      turn(spine, rig.spine);
      turn(neck, rig.neck);
      turn(head, rig.head);
      if (vrm !== null) {
        const dtS = lastPoseS === null ? 0 : Math.min(0.1, Math.max(0, timeS - lastPoseS));
        lastPoseS = timeS;
        vrm.update(dtS);
      }
    },
    dispose() {
      if (vrm !== null) {
        VRMUtils.deepDispose(model);
        return;
      }
      model.traverse((object: Object3D) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
    },
  };
}
