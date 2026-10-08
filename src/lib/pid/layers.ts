// Straturi (layers) ale modelului P&ID: vizibilitate și blocare per categorie de obiecte.
import { getSymbol } from "./symbols";
import type { Pipe, PidNode, Scheme } from "./types";

export type LayerId = "pid" | "equipment" | "pipes" | "valves" | "instruments" | "annotations" | "guides";
export interface LayerState { visible: boolean; locked: boolean }

export const LAYERS: { id: LayerId; name: string; accepts: ("node" | "pipe" | "guide")[] }[] = [
  { id: "pid", name: "P&ID (general)", accepts: ["node", "pipe"] },
  { id: "equipment", name: "Echipamente", accepts: ["node"] },
  { id: "pipes", name: "Conducte", accepts: ["pipe"] },
  { id: "valves", name: "Vane / fitinguri", accepts: ["node"] },
  { id: "instruments", name: "Instrumentație", accepts: ["node"] },
  { id: "annotations", name: "Cote / adnotări", accepts: ["node"] },
  { id: "guides", name: "Ghidaje / grilă", accepts: ["guide"] },
];

export const DEFAULT_LAYER_STATE: LayerState = { visible: true, locked: false };

/** Stratul implicit după categoria simbolului. */
export function defaultNodeLayer(n: Pick<PidNode, "type">): LayerId {
  const c = getSymbol(n.type).category;
  if (c === "Echipamente" || c === "Pompe") return "equipment";
  if (c === "Vane" || c === "Fitinguri" || c === "Traseu") return "valves";
  if (c === "Instrumentație") return "instruments";
  return "pid";
}

export const nodeLayer = (n: PidNode): LayerId => n.layer ?? defaultNodeLayer(n);
export const pipeLayer = (p: Pipe): LayerId => p.layer ?? "pipes";

export function layerState(s: Scheme, id: LayerId): LayerState {
  return { ...DEFAULT_LAYER_STATE, ...(s.layers?.[id] ?? {}) };
}

export const nodeVisible = (s: Scheme, n: PidNode) => layerState(s, nodeLayer(n)).visible;
export const pipeVisible = (s: Scheme, p: Pipe) => layerState(s, pipeLayer(p)).visible;
export const nodeLocked = (s: Scheme, n: PidNode) => layerState(s, nodeLayer(n)).locked;
export const pipeLocked = (s: Scheme, p: Pipe) => layerState(s, pipeLayer(p)).locked;

/**
 * Stratul în care intră un obiect nou: stratul curent dacă îl acceptă,
 * altfel stratul implicit al categoriei (pentru obiecte care nu aparțin stratului curent).
 */
export function layerForNew(kind: "node" | "pipe", current: LayerId, node?: Pick<PidNode, "type">): LayerId | undefined {
  const L = LAYERS.find((l) => l.id === current);
  if (L && L.accepts.includes(kind) && current !== "pid") {
    const def = kind === "pipe" ? "pipes" : defaultNodeLayer(node!);
    return current === def ? undefined : current;
  }
  return undefined; // stratul implicit al categoriei
}
