import { BufferAttribute, Group, Matrix3, Matrix4, SkinnedMesh, Vector3 } from "three";
import type { Object3D } from "three";
import { EXPRESSION } from "../tracking/expressions.ts";
import { createFaceLayer } from "./avatar-face-layer.ts";
import type { FaceLayerMode } from "./avatar-face-layer.ts";
import type { FaceAnchors } from "./avatar-face-anchors.ts";
import { FACE_SHAPES, buildFaceShapes, buildHeightField } from "./avatar-shapes.ts";
import type { HeightField } from "./avatar-shapes.ts";

export interface HeadSurface {
  mesh: SkinnedMesh;
  positions: Float32Array;
  weights: Float32Array;
  height: HeightField;
}

export interface FaceRig {
  apply(expressions: Float32Array): void;
}

function headWeights(mesh: SkinnedMesh, head: Object3D): Float32Array {
  const joints = mesh.geometry.getAttribute("skinIndex");
  const amounts = mesh.geometry.getAttribute("skinWeight");
  const weights = new Float32Array(joints.count);
  const headIndex = mesh.skeleton.bones.indexOf(head);
  for (let i = 0; i < joints.count; i += 1) {
    let total = 0;
    if (joints.getX(i) === headIndex) total += amounts.getX(i);
    if (joints.getY(i) === headIndex) total += amounts.getY(i);
    if (joints.getZ(i) === headIndex) total += amounts.getZ(i);
    if (joints.getW(i) === headIndex) total += amounts.getW(i);
    weights[i] = total;
  }
  return weights;
}

// Reads the rest pose once, while no animation or morph has moved a vertex.
export function readHeadSurface(model: Object3D, head: Object3D): HeadSurface | null {
  model.updateMatrixWorld(true);
  const meshes: SkinnedMesh[] = [];
  model.traverse((object: Object3D) => {
    if (object instanceof SkinnedMesh && object.skeleton.bones.includes(head)) {
      meshes.push(object);
    }
  });
  const scored = meshes.map((mesh) => {
    const weights = headWeights(mesh, head);
    return { mesh, weights, total: weights.reduce((sum, value) => sum + value, 0) };
  });
  const best = scored.reduce<(typeof scored)[number] | null>((top, next) => (next.total > (top?.total ?? 0) ? next : top), null);
  if (best === null) {
    return null;
  }
  const { mesh, weights } = best;
  const vertex = new Vector3();
  const positions = new Float32Array(weights.length * 3);
  for (let i = 0; i < weights.length; i += 1) {
    mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
    positions[i * 3] = vertex.x;
    positions[i * 3 + 1] = vertex.y;
    positions[i * 3 + 2] = vertex.z;
  }
  return { mesh, positions, weights, height: buildHeightField(positions, weights) };
}

export function headBounds(surface: HeadSurface) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < surface.weights.length; i += 1) {
    if ((surface.weights[i] ?? 0) >= 0.5) {
      minX = Math.min(minX, surface.positions[i * 3] ?? 0);
      maxX = Math.max(maxX, surface.positions[i * 3] ?? 0);
      minY = Math.min(minY, surface.positions[i * 3 + 1] ?? 0);
      maxY = Math.max(maxY, surface.positions[i * 3 + 1] ?? 0);
    }
  }
  return minX <= maxX ? { minX, maxX, minY, maxY } : null;
}

// Morph targets offset raw geometry, which reaches the world through the skin and not the mesh's own transform.
function geometryToWorld(mesh: SkinnedMesh, head: Object3D): Matrix4 {
  const bone = mesh.skeleton.bones.indexOf(head);
  return new Matrix4()
    .copy(mesh.matrixWorld)
    .multiply(mesh.bindMatrixInverse)
    .multiply(head.matrixWorld)
    .multiply(mesh.skeleton.boneInverses[bone] ?? new Matrix4())
    .multiply(mesh.bindMatrix);
}

function installShapes(surface: HeadSurface, head: Object3D, anchors: FaceAnchors) {
  const { mesh, positions, weights, height } = surface;
  const shapes = buildFaceShapes(positions, weights, anchors, height);
  const toLocal = new Matrix3().setFromMatrix4(geometryToWorld(mesh, head).invert());
  const delta = new Vector3();
  const targets = FACE_SHAPES.map((name) => {
    const world = shapes[name];
    for (let i = 0; i < weights.length; i += 1) {
      delta.set(world[i * 3] ?? 0, world[i * 3 + 1] ?? 0, world[i * 3 + 2] ?? 0).applyMatrix3(toLocal);
      world[i * 3] = delta.x;
      world[i * 3 + 1] = delta.y;
      world[i * 3 + 2] = delta.z;
    }
    return new BufferAttribute(world, 3);
  });
  mesh.geometry.morphAttributes.position = targets;
  mesh.geometry.morphTargetsRelative = true;
  mesh.updateMorphTargets();
  mesh.material.needsUpdate = true;
}

// Overlay mode bends the model's own face and draws only blink and open mouth; drawn mode paints a whole face.
export function installFaceRig(surface: HeadSurface, head: Object3D, anchors: FaceAnchors, mode: FaceLayerMode): FaceRig {
  if (mode === "overlay") {
    installShapes(surface, head, anchors);
  }
  const holder = new Group();
  const layer = createFaceLayer(holder, anchors, surface.height, mode);
  head.attach(holder);
  const influences = surface.mesh.morphTargetInfluences;
  return {
    apply(expressions) {
      if (mode === "overlay" && influences !== undefined) {
        influences[0] = expressions[EXPRESSION.smile] ?? 0;
        influences[1] = expressions[EXPRESSION.browRaise] ?? 0;
        influences[2] = expressions[EXPRESSION.jawOpen] ?? 0;
        influences[3] = expressions[EXPRESSION.squintA] ?? 0;
        influences[4] = expressions[EXPRESSION.squintB] ?? 0;
      }
      layer.update(expressions);
    },
  };
}
