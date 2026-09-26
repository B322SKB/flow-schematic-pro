// Materials, pipe dimensions, joint technologies and fitting K-values.

export type MaterialId = "cf20" | "cf40" | "steel_carbon" | "steel_inox";
export type JointType = "fusion" | "threaded" | "welded" | "flanged" | "grooved";

export const DN_LIST = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400] as const;

// GF Cool-Fit: PE100 SDR11 carrier pipe, outer d per DN
const PE_OD: Record<number, number> = {
  15: 20, 20: 25, 25: 32, 32: 40, 40: 50, 50: 63, 65: 75, 80: 90, 100: 110,
  125: 140, 150: 160, 200: 225, 250: 280, 300: 315, 350: 355, 400: 400,
};
// Steel Sch40 / EN10255 approx inner diameters (mm)
const STEEL_ID: Record<number, number> = {
  15: 15.8, 20: 20.9, 25: 26.6, 32: 35.1, 40: 40.9, 50: 52.5, 65: 62.7, 80: 77.9,
  100: 102.3, 125: 128.2, 150: 154.1, 200: 202.7, 250: 254.5, 300: 303.2, 350: 333.4, 400: 381,
};

export interface Material {
  id: MaterialId;
  name: string;
  short: string;
  roughness: number; // mm
  dnRange: [number, number];
  joints: JointType[];
}

export const MATERIALS: Material[] = [
  { id: "cf20", name: "GF Cool-Fit 2.0 (PE100 preizolat)", short: "Cool-Fit 2.0", roughness: 0.007, dnRange: [20, 200], joints: ["fusion"] },
  { id: "cf40", name: "GF Cool-Fit 4.0 (PE100 preizolat)", short: "Cool-Fit 4.0", roughness: 0.007, dnRange: [80, 400], joints: ["fusion"] },
  { id: "steel_carbon", name: "Oțel carbon (EN10255 / Sch40)", short: "Oțel carbon", roughness: 0.045, dnRange: [15, 400], joints: ["threaded", "welded", "flanged", "grooved"] },
  { id: "steel_inox", name: "Oțel inox AISI 304/316", short: "Inox", roughness: 0.015, dnRange: [15, 400], joints: ["threaded", "welded", "flanged", "grooved"] },
];

export const JOINT_LABEL: Record<JointType, string> = {
  fusion: "Electrofuziune / sudură cap la cap",
  threaded: "Filetat",
  welded: "Sudat",
  flanged: "Flanșat",
  grooved: "Cuple canelate (Victaulic)",
};

export function jointAllowed(j: JointType, dn: number) {
  if (j === "threaded") return dn <= 50;
  if (j === "grooved") return dn >= 25;
  return true;
}

export const getMaterial = (id: MaterialId) => MATERIALS.find((m) => m.id === id)!;

export function outerDiameter(mat: MaterialId, dn: number) {
  if (mat === "cf20" || mat === "cf40") return PE_OD[dn] ?? dn;
  return undefined;
}

export function innerDiameterMm(mat: MaterialId, dn: number): number {
  if (mat === "cf20" || mat === "cf40") {
    const d = PE_OD[dn] ?? dn;
    return d - 2 * (d / 11);
  }
  return STEEL_ID[dn] ?? dn;
}

export function sizeLabel(mat: MaterialId, dn: number) {
  const od = outerDiameter(mat, dn);
  return od ? `d${od} (DN${dn})` : `DN${dn}`;
}

// Local resistance fittings
export type FittingId = "elbow90" | "elbow45" | "tee_run" | "tee_branch" | "reducer" | "strainer";
export const FITTINGS: Record<FittingId, { name: string; K: number }> = {
  elbow90: { name: "Cot 90°", K: 0.75 },
  elbow45: { name: "Cot 45°", K: 0.35 },
  tee_run: { name: "Teu – trecere", K: 0.4 },
  tee_branch: { name: "Teu – ramificație", K: 1.3 },
  reducer: { name: "Reducție", K: 0.3 },
  strainer: { name: "Filtru Y", K: 2.0 },
};
// threaded fittings are roughly double
export function fittingK(id: FittingId, joint: JointType) {
  const k = FITTINGS[id].K;
  return joint === "threaded" ? k * 1.8 : k;
}

export type CircuitId = "supply" | "return" | "glycol_s" | "glycol_r" | "cw" | "hw" | "other";
export const CIRCUITS: Record<CircuitId, { name: string; color: string }> = {
  supply: { name: "Tur apă răcită", color: "#38bdf8" },
  return: { name: "Retur apă răcită", color: "#fb923c" },
  glycol_s: { name: "Glicol tur", color: "#22d3ee" },
  glycol_r: { name: "Glicol retur", color: "#a78bfa" },
  cw: { name: "Apă condensator", color: "#34d399" },
  hw: { name: "Apă caldă / agent termic", color: "#f43f5e" },
  other: { name: "Altul", color: "#94a3b8" },
};
export const CIRCUIT_IDS = Object.keys(CIRCUITS) as CircuitId[];
export const DEFAULT_CIRCUIT_COLORS: Record<CircuitId, string> = Object.fromEntries(
  CIRCUIT_IDS.map((c) => [c, CIRCUITS[c].color]),
) as Record<CircuitId, string>;

export const CIRCUIT_PREFIX: Record<CircuitId, string> = {
  supply: "CHS", return: "CHR", glycol_s: "GS", glycol_r: "GR", cw: "CW", hw: "HW", other: "P",
};

/** Distanța între cuplele / îmbinările intermediare pe conductă (m). */
export const COUPLING_SPACING = 2;


/** Culoarea efectivă a unui circuit (personalizată la nivel de proiect). */
export function circuitColor(
  scheme: { circuitColors?: Partial<Record<CircuitId, string>> } | undefined,
  id: CircuitId,
) {
  return scheme?.circuitColors?.[id] ?? DEFAULT_CIRCUIT_COLORS[id];
}
