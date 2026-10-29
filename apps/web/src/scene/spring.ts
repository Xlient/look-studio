export const SPRING_LIMITS = {
  stiffness: { min: 10, max: 400 },
  damping: { min: 1, max: 40 },
} as const;
export const SUBSTEP_S = 1 / 120;
export const MAX_DT_S = 0.1;

export interface SpringParams {
  stiffness: number;
  damping: number;
}

export interface Spring {
  position: number;
  velocity: number;
}

export function createSpring(): Spring {
  return { position: 0, velocity: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function clampSpringParams(params: SpringParams): SpringParams {
  return {
    stiffness: clamp(params.stiffness, SPRING_LIMITS.stiffness.min, SPRING_LIMITS.stiffness.max),
    damping: clamp(params.damping, SPRING_LIMITS.damping.min, SPRING_LIMITS.damping.max),
  };
}

// Semi-implicit Euler in fixed substeps; the clamped limits keep every substep stable.
export function stepSpring(spring: Spring, target: number, params: SpringParams, dtS: number): Spring {
  if (!Number.isFinite(dtS) || dtS <= 0 || !Number.isFinite(target)) {
    return spring;
  }
  let remaining = Math.min(dtS, MAX_DT_S);
  while (remaining > 1e-9) {
    const h = Math.min(SUBSTEP_S, remaining);
    const accel = -params.stiffness * (spring.position - target) - params.damping * spring.velocity;
    spring.velocity += accel * h;
    spring.position += spring.velocity * h;
    remaining -= h;
  }
  return spring;
}

export function resetSpring(spring: Spring): Spring {
  spring.position = 0;
  spring.velocity = 0;
  return spring;
}
