export const HAIR_TILE = 64;
export const GREY_HAIR = "#b4b4b4";
const SEED = 0x5eed;
const HAIR_AREA_PER_STRAND = 6;
const STUBBLE_AREA_PER_DOT = 5;
const STRAND_MIN_PX = 3;
const STRAND_MAX_PX = 7;
const STRAND_SPREAD = 0.5;
const SHADE_JITTER = 0.15;
const ALPHA = 235;
const SCALE_DIVISOR = 160;
const SCALE_RANGE = { min: 0.35, max: 2 } as const;

export type HairStrand = "hair" | "stubble";

export interface HairTexture {
  color: string;
  grey: number;
  density: number;
  strand: HairStrand;
}

export interface PatternTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return Number.isFinite(value) ? [(value >> 16) & 255, (value >> 8) & 255, value & 255] : [0, 0, 0];
}

export function mixHex(a: string, b: string, t: number): string {
  const from = rgb(a);
  const to = rgb(b);
  const mix = (i: number) => Math.round((from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * t);
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
}

function paint(pixels: Uint8ClampedArray, size: number, x: number, y: number, color: [number, number, number], shade: number) {
  const px = ((Math.round(x) % size) + size) % size;
  const py = ((Math.round(y) % size) + size) % size;
  const i = (py * size + px) * 4;
  pixels[i] = Math.min(255, color[0] * shade);
  pixels[i + 1] = Math.min(255, color[1] * shade);
  pixels[i + 2] = Math.min(255, color[2] * shade);
  pixels[i + 3] = ALPHA;
}

// Strands wrap at the edges so the tile repeats without seams.
export function hairTilePixels(texture: HairTexture, random: () => number, size = HAIR_TILE): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const base = rgb(texture.color);
  const grey = rgb(GREY_HAIR);
  const density = Math.min(1, Math.max(0, texture.density));
  const perMark = texture.strand === "hair" ? HAIR_AREA_PER_STRAND : STUBBLE_AREA_PER_DOT;
  const marks = Math.round((density * size * size) / perMark);
  for (let n = 0; n < marks; n += 1) {
    const color = random() < texture.grey ? grey : base;
    const shade = 1 + (random() * 2 - 1) * SHADE_JITTER;
    const x = random() * size;
    const y = random() * size;
    if (texture.strand === "stubble") {
      paint(pixels, size, x, y, color, shade);
      continue;
    }
    const length = STRAND_MIN_PX + random() * (STRAND_MAX_PX - STRAND_MIN_PX);
    const angle = Math.PI / 2 + (random() * 2 - 1) * STRAND_SPREAD;
    for (let step = 0; step < length; step += 1) {
      paint(pixels, size, x + Math.cos(angle) * step, y + Math.sin(angle) * step, color, shade);
    }
  }
  return pixels;
}

export function hairTextureKey(texture: HairTexture): string {
  return `${texture.strand}:${texture.color}:${texture.grey.toFixed(2)}:${texture.density.toFixed(2)}`;
}

export function writePatternTransform(out: PatternTransform, originX: number, originY: number, eyeDistance: number): PatternTransform {
  const scale = Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, eyeDistance / SCALE_DIVISOR));
  out.a = scale;
  out.b = 0;
  out.c = 0;
  out.d = scale;
  out.e = originX;
  out.f = originY;
  return out;
}

export interface HairPatterns {
  get(texture: HairTexture): CanvasPattern | null;
}

export function createHairPatterns(
  target: Pick<CanvasRenderingContext2D, "createPattern">,
  createTile: () => { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null,
): HairPatterns {
  const cache = new Map<string, CanvasPattern | null>();
  return {
    get(texture) {
      const key = hairTextureKey(texture);
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const tile = createTile();
      let pattern: CanvasPattern | null = null;
      if (tile !== null) {
        tile.canvas.width = HAIR_TILE;
        tile.canvas.height = HAIR_TILE;
        tile.ctx.putImageData(new ImageData(hairTilePixels(texture, seededRandom(SEED)), HAIR_TILE, HAIR_TILE), 0, 0);
        pattern = target.createPattern(tile.canvas, "repeat");
      }
      cache.set(key, pattern);
      return pattern;
    },
  };
}
