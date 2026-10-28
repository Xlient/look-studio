import {
  AmbientLight,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { HeadAnchor } from "./head-anchor.ts";

const CROWN_POINTS = 5;
const CROWN_RADIUS = 0.75;
const CROWN_TILT = 0.2;

export interface LookScene {
  resize(width: number, height: number): void;
  setMirror(mirror: boolean): void;
  render(anchor: HeadAnchor): void;
  dispose(): void;
}

function buildCrown(): Group {
  const gold = new MeshStandardMaterial({ color: 0xf5c542, metalness: 0.85, roughness: 0.25, side: DoubleSide });
  const gem = new MeshStandardMaterial({ color: 0xff3fa4, emissive: 0x5a0030, metalness: 0.2, roughness: 0.1 });
  const crown = new Group();
  crown.rotation.x = CROWN_TILT;
  const band = new Mesh(new CylinderGeometry(CROWN_RADIUS, CROWN_RADIUS * 0.95, 0.32, 32, 1, true), gold);
  crown.add(band);
  for (let i = 0; i < CROWN_POINTS; i += 1) {
    const angle = (i / CROWN_POINTS) * Math.PI * 2;
    const x = Math.sin(angle) * CROWN_RADIUS;
    const z = Math.cos(angle) * CROWN_RADIUS;
    const spike = new Mesh(new ConeGeometry(0.17, 0.42, 4), gold);
    spike.position.set(x, 0.37, z);
    const jewel = new Mesh(new SphereGeometry(0.07, 12, 8), gem);
    jewel.position.set(x, 0.6, z);
    crown.add(spike, jewel);
  }
  return crown;
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

  const crown = new Group();
  crown.add(buildCrown());
  const directional = new DirectionalLight(0xffffff, 2.2);
  directional.position.set(0.3, 1, 1);
  scene.add(backdrop, crown, new AmbientLight(0xffffff, 0.9), directional);

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
    render(anchor) {
      texture.needsUpdate = true;
      crown.visible = anchor.visible;
      if (anchor.visible) {
        rotation.extractRotation(pose.fromArray(anchor.rotation));
        crown.quaternion.setFromRotationMatrix(rotation);
        crown.position.set(anchor.x, anchor.y, 0);
        crown.scale.set(anchor.scale, anchor.scale, anchor.scale);
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
