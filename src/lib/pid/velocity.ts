// Viteze recomandate pe diametre nominale. Valorile implicite pot fi modificate de utilizator
// din tabelul de viteze, iar motorul de dimensionare și avertizările le folosesc direct.
import { DN_LIST } from "./catalog";
import type { Scheme } from "./types";

export type VelocityRange = [number, number];

export const DEFAULT_VELOCITY_LIMITS: Record<number, VelocityRange> = {
  15: [0.3, 0.8],
  20: [0.3, 0.9],
  25: [0.3, 1.0],
  32: [0.4, 1.1],
  40: [0.4, 1.2],
  50: [0.5, 1.4],
  65: [0.5, 1.6],
  80: [0.6, 1.8],
  100: [0.6, 2.0],
  125: [0.7, 2.2],
  150: [0.7, 2.4],
  200: [0.8, 2.6],
  250: [0.8, 2.8],
  300: [0.9, 3.0],
  350: [0.9, 3.0],
  400: [1.0, 3.2],
};

/** Cădere liniară maximă acceptată la dimensionare [Pa/m]. */
export const DEFAULT_MAX_R = 150;

export function limitsFor(dn: number, scheme?: Scheme | undefined): VelocityRange {
  const custom = scheme?.velocityLimits?.[dn];
  if (custom && custom.length === 2) return [custom[0], custom[1]];
  const def = DEFAULT_VELOCITY_LIMITS[dn];
  if (def) return def;
  // DN în afara tabelului: se preia cea mai apropiată treaptă
  const near = [...DN_LIST].sort((a, b) => Math.abs(a - dn) - Math.abs(b - dn))[0]!;
  return DEFAULT_VELOCITY_LIMITS[near] ?? [0.3, 2.0];
}

export function maxR(scheme?: Scheme | undefined) {
  return scheme?.maxR ?? DEFAULT_MAX_R;
}
