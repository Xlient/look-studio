// three ships no types; this covers only the API used in src/scene to avoid adding @types/three.
declare module "three" {
  export const DoubleSide: number;
  export const SRGBColorSpace: string;

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
  }

  export class Quaternion {
    setFromRotationMatrix(m: Matrix4): this;
    setFromEuler(euler: Euler): this;
    copy(quaternion: Quaternion): this;
    clone(): Quaternion;
    invert(): this;
    multiply(quaternion: Quaternion): this;
  }

  export class Matrix4 {
    fromArray(array: ArrayLike<number>): this;
    extractRotation(m: Matrix4): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number, order?: string): this;
  }

  export class Box3 {
    readonly min: Vector3;
    readonly max: Vector3;
    setFromObject(object: Object3D): this;
    isEmpty(): boolean;
    getSize(target: Vector3): Vector3;
    getCenter(target: Vector3): Vector3;
  }

  export class Object3D {
    readonly position: Vector3;
    readonly rotation: Euler;
    readonly scale: Vector3;
    readonly quaternion: Quaternion;
    readonly name: string;
    readonly parent: Object3D | null;
    visible: boolean;
    renderOrder: number;
    frustumCulled: boolean;
    add(...objects: Object3D[]): this;
    lookAt(x: number, y: number, z: number): void;
    getWorldPosition(target: Vector3): Vector3;
    getWorldQuaternion(target: Quaternion): Quaternion;
    updateMatrixWorld(force?: boolean): void;
    traverse(callback: (object: Object3D) => void): void;
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {
    background: Color | null;
  }
  export class Bone extends Object3D {}

  export class BufferGeometry {
    dispose(): void;
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number);
  }
  export class CylinderGeometry extends BufferGeometry {
    constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean);
  }
  export class ConeGeometry extends BufferGeometry {
    constructor(radius?: number, height?: number, radialSegments?: number);
  }
  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }
  export class TorusGeometry extends BufferGeometry {
    constructor(radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number);
  }
  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number);
  }

  export class Color {
    constructor(hex?: number);
    setHex(hex: number): this;
  }

  export class Texture {
    colorSpace: string;
    dispose(): void;
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
    needsUpdate: boolean;
  }

  export interface MaterialParameters {
    color?: number;
    map?: Texture;
    metalness?: number;
    roughness?: number;
    side?: number;
    depthTest?: boolean;
    depthWrite?: boolean;
    emissive?: number;
  }
  export class Material {
    dispose(): void;
  }
  export class MeshBasicMaterial extends Material {
    constructor(parameters?: MaterialParameters);
  }
  export class MeshStandardMaterial extends Material {
    constructor(parameters?: MaterialParameters);
    readonly color: Color;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    geometry: BufferGeometry;
    material: Material;
  }

  export class Light extends Object3D {}
  export class AmbientLight extends Light {
    constructor(color?: number, intensity?: number);
  }
  export class DirectionalLight extends Light {
    constructor(color?: number, intensity?: number);
  }

  export class Camera extends Object3D {}
  export class OrthographicCamera extends Camera {
    constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number);
    left: number;
    right: number;
    top: number;
    bottom: number;
    updateProjectionMatrix(): void;
  }
  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    fov: number;
    aspect: number;
    near: number;
    far: number;
    updateProjectionMatrix(): void;
  }

  export interface WebGLRendererParameters {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
    alpha?: boolean;
    preserveDrawingBuffer?: boolean;
  }
  export class WebGLRenderer {
    constructor(parameters?: WebGLRendererParameters);
    readonly domElement: HTMLCanvasElement;
    outputColorSpace: string;
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Object3D, camera: Camera): void;
    dispose(): void;
  }
}

declare module "three/addons/loaders/GLTFLoader.js" {
  import type { Group } from "three";

  export interface GLTF {
    scene: Group;
  }
  export class GLTFLoader {
    parseAsync(data: ArrayBuffer, path: string): Promise<GLTF>;
  }
}
