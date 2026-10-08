/**
 * Tranzacții ale modelului: aceeași sursă alimentează Undo/Redo, Change Summary și auditul.
 * Fiecare tranzacție păstrează instantaneul schemei înainte/după (structuri imutabile,
 * deci costul este doar referința) și un rezumat al diferențelor.
 */
import type { Scheme } from "./types";

export interface ChangeSummary {
  created: string[];
  deleted: string[];
  modified: string[];
  resized: string[]; // DN schimbat
  rerouted: string[]; // traseu / puncte schimbate
  settings: boolean; // proprietăți de schemă (fluid, culori, straturi…)
}

export interface Transaction {
  id: number;
  label: string;
  at: number;
  before: Scheme;
  after: Scheme;
  summary: ChangeSummary;
}

export interface HistoryState {
  schemeId: string;
  past: Transaction[];
  future: Transaction[];
  log: { id: number; label: string; at: number; summary: ChangeSummary; undone?: boolean }[];
  seq: number;
}

export const HISTORY_LIMIT = 100;
export const LOG_LIMIT = 200;

export const emptyHistory = (schemeId: string): HistoryState => ({ schemeId, past: [], future: [], log: [], seq: 0 });

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Diferențele dintre două versiuni ale schemei (bază și pentru viitorul „compare revisions”). */
export function diffSchemes(a: Scheme, b: Scheme): ChangeSummary {
  const out: ChangeSummary = { created: [], deleted: [], modified: [], resized: [], rerouted: [], settings: false };
  const tagOf = (o: { tag: string; id: string }) => o.tag || o.id;
  const an = new Map(a.nodes.map((n) => [n.id, n])), bn = new Map(b.nodes.map((n) => [n.id, n]));
  for (const [id, n] of bn) {
    const o = an.get(id);
    if (!o) out.created.push(tagOf(n));
    else if (o !== n && !same(o, n)) out.modified.push(tagOf(n));
  }
  for (const [id, n] of an) if (!bn.has(id)) out.deleted.push(tagOf(n));
  const ap = new Map(a.pipes.map((p) => [p.id, p])), bp = new Map(b.pipes.map((p) => [p.id, p]));
  for (const [id, p] of bp) {
    const o = ap.get(id);
    if (!o) { out.created.push(tagOf(p)); continue; }
    if (o === p) continue;
    if (o.dn !== p.dn) out.resized.push(tagOf(p));
    if (!same(o.points, p.points) || o.routing !== p.routing) out.rerouted.push(tagOf(p));
    const { dn: _a, points: _b, routing: _c, ...ro } = o;
    const { dn: _d, points: _e, routing: _f, ...rp } = p;
    if (!same(ro, rp)) out.modified.push(tagOf(p));
  }
  for (const [id, p] of ap) if (!bp.has(id)) out.deleted.push(tagOf(p));
  const keys = ["name", "fluid", "concentration", "temperature", "deltaT", "circuitColors", "customSymbols", "guides", "velocityLimits", "maxR", "staticHeight", "tStagnation", "reliefPressure", "revision", "layers"] as const;
  out.settings = keys.some((k) => !same(a[k], b[k]));
  return out;
}

export const isEmptySummary = (c: ChangeSummary) =>
  !c.created.length && !c.deleted.length && !c.modified.length && !c.resized.length && !c.rerouted.length && !c.settings;

export const COALESCE_MS = 1000;

/**
 * Înregistrează o tranzacție; golește stiva de redo; limitează istoricul.
 * `coalesce`: editări repetate cu aceeași etichetă (tastare într-un câmp, nudge cu săgeți) în
 * fereastra COALESCE_MS se contopesc într-o singură tranzacție.
 */
export function record(h: HistoryState, label: string, before: Scheme, after: Scheme, now = Date.now(), coalesce = false): HistoryState {
  if (before === after) return h;
  const last = h.past[h.past.length - 1];
  if (coalesce && last && !h.future.length && last.label === label && now - last.at < COALESCE_MS && last.after === before) {
    const summary = diffSchemes(last.before, after);
    const tx: Transaction = { ...last, after, at: now, summary };
    const log = h.log.map((l) => (l.id === last.id ? { ...l, at: now, summary } : l));
    return { ...h, past: [...h.past.slice(0, -1), tx], log };
  }
  const summary = diffSchemes(before, after);
  if (isEmptySummary(summary)) return h;
  const id = h.seq + 1;
  const tx: Transaction = { id, label, at: now, before, after, summary };
  return {
    ...h,
    seq: id,
    past: [...h.past, tx].slice(-HISTORY_LIMIT),
    future: [],
    log: [...h.log, { id, label, at: now, summary }].slice(-LOG_LIMIT),
  };
}

export function undo(h: HistoryState): { history: HistoryState; scheme: Scheme; label: string } | null {
  const tx = h.past[h.past.length - 1];
  if (!tx) return null;
  return {
    history: {
      ...h, past: h.past.slice(0, -1), future: [...h.future, tx],
      log: [...h.log, { id: h.seq + 1, label: `Undo: ${tx.label}`, at: Date.now(), summary: diffSchemes(tx.after, tx.before), undone: true }].slice(-LOG_LIMIT),
      seq: h.seq + 1,
    },
    scheme: tx.before,
    label: tx.label,
  };
}

export function redo(h: HistoryState): { history: HistoryState; scheme: Scheme; label: string } | null {
  const tx = h.future[h.future.length - 1];
  if (!tx) return null;
  return {
    history: {
      ...h, future: h.future.slice(0, -1), past: [...h.past, tx],
      log: [...h.log, { id: h.seq + 1, label: `Redo: ${tx.label}`, at: Date.now(), summary: tx.summary }].slice(-LOG_LIMIT),
      seq: h.seq + 1,
    },
    scheme: tx.after,
    label: tx.label,
  };
}

/** Rezumat cumulat al sesiunii (pentru panoul „Modificări”). */
export function sessionSummary(h: HistoryState) {
  const acc = { created: new Set<string>(), deleted: new Set<string>(), modified: new Set<string>(), resized: new Set<string>(), rerouted: new Set<string>() };
  for (const t of h.past) for (const k of ["created", "deleted", "modified", "resized", "rerouted"] as const) for (const x of t.summary[k]) acc[k].add(x);
  return {
    created: [...acc.created], deleted: [...acc.deleted], modified: [...acc.modified],
    resized: [...acc.resized], rerouted: [...acc.rerouted], transactions: h.past.length,
  };
}

export function describeSummary(c: ChangeSummary) {
  const parts: string[] = [];
  if (c.created.length) parts.push(`+${c.created.length} create`);
  if (c.deleted.length) parts.push(`−${c.deleted.length} șterse`);
  if (c.resized.length) parts.push(`${c.resized.length} redimensionate`);
  if (c.rerouted.length) parts.push(`${c.rerouted.length} rerutate`);
  if (c.modified.length) parts.push(`${c.modified.length} modificate`);
  if (c.settings) parts.push("setări");
  return parts.join(" · ");
}
