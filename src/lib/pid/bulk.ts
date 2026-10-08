// Editare în masă (bulk) cu valori „mixed” și validarea compatibilității.
import { getMaterial, jointAllowed, type CircuitId, type JointType, type MaterialId } from "./catalog";
import { nodeLocked, pipeLocked, type LayerId } from "./layers";
import { getSymbol } from "./symbols";
import type { Pipe, PidNode, Scheme } from "./types";

export const MIXED = Symbol("mixed");
export type Mixed<T> = T | typeof MIXED | undefined;

/** Valoarea comună a unui câmp într-o listă de obiecte sau MIXED dacă diferă. */
export function commonValue<T, K extends keyof T>(items: T[], key: K): Mixed<T[K]> {
  if (!items.length) return undefined;
  const v = items[0]![key];
  return items.every((x) => JSON.stringify(x[key]) === JSON.stringify(v)) ? v : MIXED;
}

export interface PipeBulkPatch {
  circuit?: CircuitId | undefined;
  material?: MaterialId | undefined;
  joint?: JointType | undefined;
  dn?: number | undefined;
  insulation?: string | undefined;
  disabled?: boolean | undefined;
  layer?: LayerId | undefined;
  length?: number | undefined;
}

export interface BulkResult { scheme: Scheme; changed: string[]; skipped: { id: string; tag: string; reason: string }[]; warnings: string[] }

/** Aplică un patch pe toate conductele; câmpurile incompatibile sunt sărite cu avertizare, nu forțate. */
export function bulkEditPipes(s: Scheme, ids: string[], patch: PipeBulkPatch): BulkResult {
  const sel = new Set(ids);
  const changed: string[] = [];
  const skipped: BulkResult["skipped"] = [];
  const warnings = new Set<string>();
  const pipes = s.pipes.map((p) => {
    if (!sel.has(p.id)) return p;
    if (pipeLocked(s, p)) { skipped.push({ id: p.id, tag: p.tag, reason: "strat blocat" }); return p; }
    const next: Pipe = { ...p };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
    const m = getMaterial(next.material);
    if (next.dn < m.dnRange[0] || next.dn > m.dnRange[1]) {
      if (patch.dn !== undefined) { skipped.push({ id: p.id, tag: p.tag, reason: `DN${next.dn} în afara gamei ${m.short}` }); return p; }
      next.dn = Math.min(m.dnRange[1], Math.max(m.dnRange[0], next.dn));
      warnings.add(`DN ajustat la gama materialului ${m.short}`);
    }
    if (!m.joints.includes(next.joint) || !jointAllowed(next.joint, next.dn)) {
      if (patch.joint !== undefined) { skipped.push({ id: p.id, tag: p.tag, reason: `îmbinarea ${patch.joint} nu este permisă pentru ${m.short} DN${next.dn}` }); return p; }
      next.joint = m.joints.find((j) => jointAllowed(j, next.dn)) ?? m.joints[0]!;
      warnings.add(`îmbinare ajustată pentru ${m.short}`);
    }
    if (JSON.stringify(next) === JSON.stringify(p)) return p;
    changed.push(p.id);
    return next;
  });
  return { scheme: { ...s, pipes }, changed, skipped, warnings: [...warnings] };
}

export interface NodeBulkPatch {
  redundant?: boolean | undefined;
  layer?: LayerId | undefined;
  dn?: number | undefined; // doar vane / fitinguri
  rotation?: number | undefined;
  dpFixed?: number | undefined; // doar echipamente
}

export function bulkEditNodes(s: Scheme, ids: string[], patch: NodeBulkPatch): BulkResult {
  const sel = new Set(ids);
  const changed: string[] = [];
  const skipped: BulkResult["skipped"] = [];
  const nodes = s.nodes.map((n) => {
    if (!sel.has(n.id)) return n;
    if (nodeLocked(s, n)) { skipped.push({ id: n.id, tag: n.tag, reason: "strat blocat" }); return n; }
    const sym = getSymbol(n.type);
    const next: PidNode = { ...n };
    if (patch.layer !== undefined) next.layer = patch.layer;
    if (patch.rotation !== undefined) next.rotation = patch.rotation;
    if (patch.redundant !== undefined) {
      if (sym.terminal || sym.source) next.redundant = patch.redundant;
      else skipped.push({ id: n.id, tag: n.tag, reason: "Activ/Redundant se aplică doar echipamentelor terminale și surselor" });
    }
    if (patch.dn !== undefined) {
      if (sym.bomGroup === "Vane" || sym.bomGroup === "Fitinguri") next.dn = patch.dn;
      else skipped.push({ id: n.id, tag: n.tag, reason: "DN se aplică doar vanelor și fitingurilor" });
    }
    if (patch.dpFixed !== undefined) {
      if (sym.bomGroup === "Echipamente") next.dpFixed = patch.dpFixed;
      else skipped.push({ id: n.id, tag: n.tag, reason: "Δp fix se aplică doar echipamentelor" });
    }
    if (JSON.stringify(next) === JSON.stringify(n)) return n;
    changed.push(n.id);
    return next;
  });
  return { scheme: { ...s, nodes }, changed, skipped, warnings: [] };
}
