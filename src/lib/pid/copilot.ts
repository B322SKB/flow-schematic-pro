/**
 * Copilot – scaffold determinist, separat de motorul de calcul.
 * Flux obligatoriu: intenție → propunere (Proposal, fără efecte) → Preview → Apply / Reject.
 * Un viitor furnizor AI va implementa aceeași interfață `CopilotProvider`, producând tot propuneri;
 * aplicarea rămâne exclusiv prin `applyProposal` (tranzacție unică, undo-abilă).
 */
import { fluidProps } from "./fluids";
import { MATERIALS, type MaterialId } from "./catalog";
import { searchObjects } from "./search";
import { planSizing } from "./sizing";
import { maxR } from "./velocity";
import type { State, VisualMode } from "./store";
import type { Scheme } from "./types";

export type ProposalAction =
  | { kind: "select"; nodes: string[]; pipes: string[] }
  | { kind: "view"; mode: VisualMode }
  | { kind: "scheme"; scheme: Scheme; label: string };

export interface Proposal {
  intent: string;
  summary: string;
  /** lista de modificări pentru preview */
  preview: string[];
  action: ProposalAction | null;
  mutates: boolean;
}

export interface CopilotProvider {
  name: string;
  propose: (text: string, st: State) => Proposal | Promise<Proposal>;
}

const selected = (st: State) => (st.multiPipes.length ? st.multiPipes : st.selected?.kind === "pipe" ? [st.selected.id] : []);

/** Furnizor local, determinist (fără rețea): recunoaște comenzi uzuale în română/engleză. */
export const localProvider: CopilotProvider = {
  name: "local",
  propose: (text, st) => {
    const t = text.trim().toLowerCase();
    const s = st.scheme;
    const none = (summary: string): Proposal => ({ intent: text, summary, preview: [], action: null, mutates: false });
    if (!t) return none("Scrie o comandă, de ex. „Select all pipes DN100”.");

    const dn = /dn\s*(\d+)/.exec(t)?.[1];
    if (/(select|selecteaz)/.test(t) && /(pipe|conduct)/.test(t)) {
      const pipes = s.pipes.filter((p) => !dn || p.dn === Number(dn)).map((p) => p.id);
      return { intent: text, summary: `Selectează ${pipes.length} conducte${dn ? ` DN${dn}` : ""}`, preview: pipes.slice(0, 20).map((id) => s.pipes.find((p) => p.id === id)!.tag),
        action: { kind: "select", nodes: [], pipes }, mutates: false };
    }
    if (/(select|selecteaz)/.test(t) && /(equip|echipament)/.test(t)) {
      const hits = searchObjects(s, "equipment").map((h) => h.id);
      return { intent: text, summary: `Selectează ${hits.length} echipamente`, preview: hits.slice(0, 20).map((id) => s.nodes.find((n) => n.id === id)!.tag),
        action: { kind: "select", nodes: hits, pipes: [] }, mutates: false };
    }
    if (/(critical|critic)/.test(t)) return { intent: text, summary: "Afișează traseul critic", preview: ["Mod vizual: Critical Path"], action: { kind: "view", mode: "critical" }, mutates: false };
    if (/(warning|avertiz|engineering)/.test(t)) return { intent: text, summary: "Afișează avertizările Engineering Check", preview: ["Mod vizual: Engineering Check"], action: { kind: "view", mode: "check" }, mutates: false };
    if (/(auto.?size|dimension)/.test(t)) {
      const ids = selected(st);
      const target = ids.length ? new Set(ids) : new Set(s.pipes.map((p) => p.id));
      const fp = fluidProps(s.fluid, s.concentration, s.temperature);
      const plan = planSizing(s, fp, { mode: "legacy", rMax: maxR(s) });
      const ch = [...plan.changes].filter(([id]) => target.has(id));
      if (!ch.length) return none("Dimensiunile actuale respectă deja criteriile.");
      const next: Scheme = { ...s, pipes: s.pipes.map((p) => { const d = ch.find(([id]) => id === p.id)?.[1]; return d ? { ...p, dn: d } : p; }) };
      return { intent: text, summary: `Redimensionează ${ch.length} conducte`, preview: ch.map(([id, d]) => { const p = s.pipes.find((x) => x.id === id)!; return `${p.tag}: DN${p.dn} → DN${d}`; }),
        action: { kind: "scheme", scheme: next, label: `Copilot: auto-size (${ch.length})` }, mutates: true };
    }
    const mat = MATERIALS.find((m) => t.includes(m.short.toLowerCase()) || t.includes(m.id));
    if (mat && /(material|schimb|set)/.test(t)) {
      const ids = new Set(selected(st));
      if (!ids.size) return none("Selectează întâi conductele pentru schimbarea materialului.");
      const next: Scheme = { ...s, pipes: s.pipes.map((p) => (ids.has(p.id) ? { ...p, material: mat.id as MaterialId } : p)) };
      return { intent: text, summary: `Material ${mat.short} pentru ${ids.size} conducte`, preview: s.pipes.filter((p) => ids.has(p.id)).map((p) => `${p.tag}: ${p.material} → ${mat.id}`),
        action: { kind: "scheme", scheme: next, label: `Copilot: material ${mat.short}` }, mutates: true };
    }
    if (/^(find|caut|gaseste)/.test(t)) {
      const q = t.replace(/^(find|cauta|caută|gaseste)\s*/, "");
      const hits = searchObjects(s, q);
      return { intent: text, summary: `${hits.length} rezultate pentru „${q}”`, preview: hits.slice(0, 20).map((h) => h.label),
        action: { kind: "select", nodes: hits.filter((h) => h.kind === "node").map((h) => h.id), pipes: hits.filter((h) => h.kind === "pipe").map((h) => h.id) }, mutates: false };
    }
    return none("Comandă nerecunoscută. Exemple: „Select all pipes DN100”, „Show critical path”, „Auto-size selected”, „Find CCU”.");
  },
};

/** Aplică o propunere aprobată – singura cale prin care copilotul poate modifica modelul. */
export function applyProposal(p: Proposal, st: State) {
  const a = p.action;
  if (!a) return;
  if (a.kind === "select") { st.setSelection(a.nodes, a.pipes); st.requestView({ kind: "selection" }); }
  else if (a.kind === "view") st.setVisualMode(a.mode);
  else st.transact(a.label, () => applySchemeDiff(st, a.scheme));
}

// schema propusă se aplică printr-o editare în masă a câmpurilor diferite (păstrând blocările de strat)
function applySchemeDiff(st: State, next: Scheme) {
  const cur = st.scheme;
  for (const p of next.pipes) {
    const o = cur.pipes.find((x) => x.id === p.id);
    if (!o || o === p) continue;
    st.bulkPipes({ dn: p.dn !== o.dn ? p.dn : undefined, material: p.material !== o.material ? p.material : undefined }, [p.id]);
  }
  return true;
}
