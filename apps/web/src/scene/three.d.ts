// three ships no types; this covers only the API used in src/scene to avoid adding @types/three.
declare module "three" {
  export const DoubleSide: number;
  export const SRGBColorSpace: string;

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }

  export class Quaternion {
    setFromRotationMatrix(m: Matrix4): this;
  }

  export class Matrix4 {
    fromArray(array: ArrayLike<number>): this;
    extractRotation(m: Matrix4): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
  }

  export class Object3D {
    readonly position: Vector3;
    readonly rotation: Euler;
    readonly scale: Vector3;
    readonly quaternion: Quaternion;
    visible: boolean;
    renderOrder: number;
    add(...objects: Object3D[]): this;
    traverse(callback: (object: Object3D) => void): void;
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {}

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

  export class Texture {
    colorSpace: string;
    dispose(): void;
  }
  export class VideoTexture extends Texture {
    constructor(video: HTMLVideoElement);
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
