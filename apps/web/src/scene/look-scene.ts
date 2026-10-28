import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { HeadAnchor } from "./head-anchor.ts";
import { EMPTY_LAYOUT } from "./wearable-layout.ts";
import type { WearableLayout, WearableSlot } from "./wearable-layout.ts";
import { buildCrown, buildGlasses, buildHat } from "./wearable-templates.ts";
import type { WearableTemplate } from "./wearable-templates.ts";

export interface LookScene {
  resize(width: number, height: number): void;
  setMirror(mirror: boolean): void;
  setWearables(layout: WearableLayout): void;
  render(anchor: HeadAnchor): void;
  dispose(): void;
}

function wrap(template: WearableTemplate): Group {
  const holder = new Group();
  holder.add(template.group);
  holder.visible = false;
  return holder;
}

function place(holder: Group, template: WearableTemplate, slot: WearableSlot | null) {
  holder.visible = slot !== null;
  if (slot !== null) {
    template.tint.color.setHex(slot.color);
    holder.position.set(slot.offset.x, slot.offset.y, slot.offset.z);
    holder.scale.set(slot.scale, slot.scale, slot.scale);
  }
}

export function createLookScene(canvas: HTMLCanvasElement, backdropSource: HTMLCanvasElement): LookScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
  camera.position.set(0, 0, 5_000);

  const texture = new CanvasTexture(backdropSource);
  texture.colorSpace = SRGBColorSpace;
  const backdrop = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: texture, depthWrite: false }));
  backdrop.position.set(0, 0, -4_000);
  backdrop.renderOrder = -1;

  const crown = buildCrown();
  const hat = buildHat();
  const glasses = buildGlasses();
  const crownHolder = wrap(crown);
  const hatHolder = wrap(hat);
  const glassesHolder = wrap(glasses);
  const headPivot = new Group();
  headPivot.add(crownHolder, hatHolder);
  const eyesPivot = new Group();
  eyesPivot.add(glassesHolder);
  const directional = new DirectionalLight(0xffffff, 2.2);
  directional.position.set(0.3, 1, 1);
  scene.add(backdrop, headPivot, eyesPivot, new AmbientLight(0xffffff, 0.9), directional);

  const setWearables = (layout: WearableLayout) => {
    const head = layout.head;
    place(crownHolder, crown, head?.template === "crown" ? head : null);
    place(hatHolder, hat, head?.template === "hat" ? head : null);
    place(glassesHolder, glasses, layout.eyes);
  };
  setWearables(EMPTY_LAYOUT);

  const pose = new Matrix4();
  const rotation = new Matrix4();
  let mirror = true;
  let width = 1;

  const resize = (w: number, h: number) => {
    width = w;
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    backdrop.scale.set(mirror ? -w : w, h, 1);
  };

  return {
    resize,
    setMirror(next) {
      mirror = next;
      backdrop.scale.set(mirror ? -width : width, backdrop.scale.y, 1);
    },
    setWearables,
    render(anchor) {
      texture.needsUpdate = true;
      headPivot.visible = anchor.visible;
      eyesPivot.visible = anchor.visible;
      if (anchor.visible) {
        rotation.extractRotation(pose.fromArray(anchor.rotation));
        headPivot.quaternion.setFromRotationMatrix(rotation);
        eyesPivot.quaternion.setFromRotationMatrix(rotation);
        headPivot.position.set(anchor.x, anchor.y, 0);
        eyesPivot.position.set(anchor.eyesX, anchor.eyesY, 0);
        headPivot.scale.set(anchor.scale, anchor.scale, anchor.scale);
        eyesPivot.scale.set(anchor.scale, anchor.scale, anchor.scale);
      }
      renderer.render(scene, camera);
    },
    dispose() {
      scene.traverse((object: Object3D) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
      texture.dispose();
      renderer.dispose();
    },
  };
}
