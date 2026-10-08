/**
 * Engineering Check (Etapa 3): verificări pe fiecare conductă și echipament și sumar de proiect.
 * Se bazează pe rezultatul solverului de rețea (debite convergente) — nu păstrează rezultate vechi.
 */
import type { FluidProps } from "./fluids";
import { RE_LAMINAR, RE_TURBULENT } from "./hydraulics";
import { nodeDemand } from "./network";
import { solveNetwork, type SolverResult } from "./solver";
import { getSymbol } from "./symbols";
import { duplicateTags } from "./tags";
import type { Scheme } from "./types";
import { limitsFor, maxR } from "./velocity";

export type CheckLevel = "ok" | "warning" | "incomplete" | "unresolved";
const RANK: Record<CheckLevel, number> = { unresolved: 3, incomplete: 2, warning: 1, ok: 0 };
const worst = (a: CheckLevel, b: CheckLevel) => (RANK[a] >= RANK[b] ? a : b);

export interface CheckItem {
  metric: "velocity" | "gradient" | "reynolds" | "data" | "equipment_dp" | "flow" | "solver";
  label: string;
  value?: number | undefined;
  limit?: string | undefined;
  /** diferența față de limită, % (pozitiv = depășire) */
  deviation?: number | undefined;
  level: CheckLevel;
  message: string;
}

export interface ElementCheck {
  id: string;
  tag: string;
  kind: "pipe" | "equipment";
  level: CheckLevel;
  items: CheckItem[];
}

export interface ProjectSummary {
  status: CheckLevel;
  counts: Record<CheckLevel, number>;
  elements: ElementCheck[];
  /** probleme ordonate: unresolved > incomplete > warning, apoi după mărimea depășirii */
  issues: { id: string; tag: string; level: CheckLevel; message: string; deviation: number }[];
  solution: SolverResult;
}

const pct = (v: number, lim: number) => (lim > 0 ? ((v - lim) / lim) * 100 : 0);

export function engineeringCheck(scheme: Scheme, fp: FluidProps, solution?: SolverResult): ProjectSummary {
  const sol = solution ?? solveNetwork(scheme, fp);
  const elements: ElementCheck[] = [];
  const rMax = maxR(scheme);
  const unresolved = new Set(sol.unresolvedPipes);

  for (const p of scheme.pipes) {
    if (p.disabled) continue;
    const items: CheckItem[] = [];
    const r = sol.pipes.get(p.id);
    if (!p.dn || !p.material) items.push({ metric: "data", label: "DN / material", level: "incomplete", message: "DN sau material lipsă" });
    if (unresolved.has(p.id) || !r) {
      items.push({ metric: "solver", label: "Solver", level: "unresolved", message: "Debit nerezolvat de solver" });
    } else if (!p.direct) {
      const q = Math.abs(r.flowSigned);
      if (q <= 0) items.push({ metric: "flow", label: "Debit", value: 0, level: "incomplete", message: "Debit zero / lipsă" });
      else {
        const [vMin, vMax] = limitsFor(p.dn, scheme);
        const vLevel: CheckLevel = r.v > vMax || r.v < vMin ? "warning" : "ok";
        items.push({ metric: "velocity", label: "Viteză", value: r.v, limit: `${vMin}–${vMax} m/s`,
          deviation: r.v > vMax ? pct(r.v, vMax) : r.v < vMin ? -pct(vMin, r.v || 1e-9) : 0,
          level: vLevel, message: r.v > vMax ? `v=${r.v.toFixed(2)} > ${vMax} m/s` : r.v < vMin ? `v=${r.v.toFixed(2)} < ${vMin} m/s` : "în interval" });
        items.push({ metric: "gradient", label: "Pa/m", value: r.R, limit: `≤ ${rMax} Pa/m`, deviation: pct(r.R, rMax),
          level: r.R > rMax ? "warning" : "ok", message: r.R > rMax ? `R=${r.R.toFixed(0)} > ${rMax} Pa/m` : "în limită" });
        const tr = r.Re >= RE_LAMINAR && r.Re < RE_TURBULENT;
        items.push({ metric: "reynolds", label: "Re", value: r.Re, limit: `regim ${r.regime}`, level: tr ? "warning" : "ok",
          message: tr ? "Re în zona de tranziție — rezultat nedefinitiv" : r.regime });
      }
    }
    const level = items.reduce<CheckLevel>((a, i) => worst(a, i.level), "ok");
    elements.push({ id: p.id, tag: p.tag, kind: "pipe", level, items });
  }

  for (const n of scheme.nodes) {
    const sym = getSymbol(n.type);
    if (!sym.terminal && !sym.source) continue;
    const items: CheckItem[] = [];
    const hasDp = !!n.dpFixed || n.kOverride !== undefined || sym.K !== undefined;
    items.push({ metric: "equipment_dp", label: "Δp echipament", value: n.dpFixed, limit: "definit",
      level: hasDp ? "ok" : "incomplete", message: hasDp ? `${n.dpFixed ?? "K"} kPa` : "Δp echipament lipsă" });
    if (sym.terminal && !n.redundant) {
      const d = nodeDemand(n, scheme, fp);
      items.push({ metric: "flow", label: "Debit", value: d, level: d > 0 ? "ok" : "incomplete", message: d > 0 ? `${d.toFixed(2)} m³/h` : "fără debit / kW" });
      const t = sol.terminals.find((x) => x.id === n.id);
      const err = sol.warnings.find((w) => w.code === "terminal_no_path" && w.target === n.id);
      if (err) items.push({ metric: "solver", label: "Cale la sursă", level: "unresolved", message: err.message });
      else if (t) items.push({ metric: "solver", label: "Δp de la sursă", value: t.dpFromSource, level: "ok", message: `${(t.dpFromSource / 1000).toFixed(1)} kPa` });
    }
    const level = items.reduce<CheckLevel>((a, i) => worst(a, i.level), "ok");
    elements.push({ id: n.id, tag: n.tag, kind: "equipment", level, items });
  }

  // tag-uri duplicate → warning pe fiecare obiect afectat
  for (const [tag, ids] of duplicateTags(scheme)) {
    for (const id of ids) {
      const e = elements.find((x) => x.id === id);
      const item: CheckItem = { metric: "data", label: "Tag", level: "warning", message: `tag duplicat „${tag}” (${ids.length} obiecte)` };
      if (e) { e.items.push(item); e.level = worst(e.level, "warning"); }
      else {
        const n = scheme.nodes.find((x) => x.id === id);
        if (n) elements.push({ id, tag: n.tag, kind: "equipment", level: "warning", items: [item] });
      }
    }
  }

  const counts: Record<CheckLevel, number> = { ok: 0, warning: 0, incomplete: 0, unresolved: 0 };
  for (const e of elements) counts[e.level]++;
  let status = elements.reduce<CheckLevel>((a, e) => worst(a, e.level), "ok");
  if (!sol.converged) status = "unresolved";
  else if (sol.warnings.some((w) => w.severity === "error")) status = worst(status, "incomplete");

  const issues: ProjectSummary["issues"] = [];
  for (const e of elements) for (const i of e.items) {
    if (i.level === "ok") continue;
    issues.push({ id: e.id, tag: e.tag, level: i.level, message: `${i.label}: ${i.message}`, deviation: Math.abs(i.deviation ?? 0) });
  }
  for (const w of sol.warnings) {
    if (w.severity === "error" && !issues.some((x) => x.message.includes(w.message))) {
      issues.push({ id: w.target ?? "", tag: "Rețea", level: w.code === "not_converged" ? "unresolved" : "incomplete", message: w.message, deviation: 0 });
    }
  }
  issues.sort((a, b) => RANK[b.level] - RANK[a.level] || b.deviation - a.deviation);
  return { status, counts, elements, issues, solution: sol };
}
