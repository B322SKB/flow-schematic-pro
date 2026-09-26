// Analiza rețelei: propagarea debitelor la teuri, traseul critic și punctul de funcționare al pompei.
import { flowFromKw, type FluidProps } from "./fluids";
import { computePipe } from "./hydraulics";
import { getSymbol } from "./symbols";
import type { PidNode, Scheme } from "./types";

/** Debitul cerut de un element consumator [m³/h]. Elementele redundante nu consumă în regim normal. */
export function nodeDemand(n: PidNode, s: Scheme, fp: FluidProps): number {
  const sym = getSymbol(n.type);
  if (!sym.terminal || n.redundant) return 0;
  if (n.flow) return n.flow;
  if (n.kw) return flowFromKw(n.kw, n.deltaT ?? s.deltaT, fp);
  return 0;
}

/** Debitul total cerut de toate echipamentele terminale active [m³/h]. */
export function totalDemand(s: Scheme, fp: FluidProps) {
  return s.nodes.reduce((t, n) => t + nodeDemand(n, s, fp), 0);
}

export interface FlowInfo {
  flow: number; // m³/h însumat din consumatorii deserviți
  ambiguous: boolean; // tronson de inel: debitul nu poate fi dedus univoc
}

/**
 * Legea I a lui Kirchhoff: debitul unui tronson = suma cererilor consumatorilor
 * care rămân fără alimentare dacă tronsonul este eliminat.
 * Pe tronsoanele de inel (eliminarea nu întrerupe alimentarea) debitul rămâne manual.
 */
export function propagateFlows(scheme: Scheme, fp: FluidProps): Map<string, FlowInfo> {
  const out = new Map<string, FlowInfo>();
  const pipes = scheme.pipes.filter((p) => !p.disabled);
  const sources = scheme.nodes.filter((n) => getSymbol(n.type).source && !n.redundant).map((n) => n.id);
  if (!sources.length || !pipes.length) return out;

  const demand = new Map<string, number>();
  for (const n of scheme.nodes) demand.set(n.id, nodeDemand(n, scheme, fp));

  const reach = (skip: string | null) => {
    const seen = new Set(sources);
    const q = [...sources];
    while (q.length) {
      const id = q.shift()!;
      for (const p of pipes) {
        if (p.id === skip) continue;
        const nb = p.from.node === id ? p.to.node : p.to.node === id ? p.from.node : null;
        if (nb && !seen.has(nb)) { seen.add(nb); q.push(nb); }
      }
    }
    return seen;
  };

  const all = reach(null);
  for (const p of pipes) {
    const without = reach(p.id);
    let f = 0, cut = 0;
    for (const id of all) {
      if (without.has(id)) continue;
      cut++;
      f += demand.get(id) ?? 0;
    }
    out.set(p.id, cut === 0 ? { flow: 0, ambiguous: true } : { flow: Math.round(f * 100) / 100, ambiguous: false });
  }
  return out;
}

export interface CriticalPath {
  pipes: string[]; // tronsoanele traseului, în ordine
  dp: number; // Pa
  endTag: string; // consumatorul cel mai dezavantajat
  terminal: boolean;
}

/** Traseul hidraulic cu pierderea cumulată maximă, de la sursă la un consumator. */
export function criticalPath(scheme: Scheme, fp: FluidProps): CriticalPath | null {
  const pipes = scheme.pipes.filter((p) => !p.disabled);
  const sources = scheme.nodes.filter((n) => getSymbol(n.type).source && !n.redundant).map((n) => n.id);
  if (!sources.length || !pipes.length) return null;
  const dp = new Map(pipes.map((p) => [p.id, computePipe(p, scheme, fp).dpTotal] as const));
  const byNode = new Map<string, typeof pipes>();
  for (const p of pipes) {
    for (const id of [p.from.node, p.to.node]) {
      const list = byNode.get(id) ?? [];
      list.push(p);
      byNode.set(id, list);
    }
  }
  let best: CriticalPath | null = null;
  let budget = 400_000;
  const used: string[] = [];
  const visited = new Set<string>();

  const consider = (nodeId: string) => {
    if (!used.length) return;
    const n = scheme.nodes.find((x) => x.id === nodeId);
    const term = !!n && !!getSymbol(n.type).terminal;
    let acc = 0;
    for (const id of used) acc += dp.get(id) ?? 0;
    // un traseu care ajunge la un consumator are prioritate față de unul oarecare
    if (!best || (term && !best.terminal) || (term === best.terminal && acc > best.dp)) {
      best = { pipes: [...used], dp: acc, endTag: n?.tag ?? "—", terminal: term };
    }
  };

  const walk = (nodeId: string) => {
    if (budget-- <= 0 || used.length > 60) return;
    consider(nodeId);
    for (const p of byNode.get(nodeId) ?? []) {
      if (used.includes(p.id)) continue;
      const nb = p.from.node === nodeId ? p.to.node : p.from.node;
      if (visited.has(nb)) continue;
      visited.add(nb);
      used.push(p.id);
      walk(nb);
      used.pop();
      visited.delete(nb);
    }
  };

  for (const s of sources) {
    visited.clear();
    visited.add(s);
    walk(s);
  }
  return best;
}

export interface PumpDuty {
  dpCritical: number; // Pa, traseul cel mai dezavantajat
  integratedHead: number; // Pa, presiune utilă a modulelor hidraulice integrate
  net: number; // Pa, rămas de acoperit de pompele exterioare
  headM: number; // mCA
  margin: number; // mCA, cu marjă de 10%
  flow: number; // m³/h
  path: CriticalPath | null;
  covered: boolean; // modulul integrat acoperă tot circuitul
}

/** Punctul de funcționare cerut: sarcina pompei pe traseul critic. */
export function pumpDuty(scheme: Scheme, fp: FluidProps): PumpDuty {
  const path = criticalPath(scheme, fp);
  const dpCritical = path?.dp ?? 0;
  let integratedHead = 0;
  for (const n of scheme.nodes) {
    if (!getSymbol(n.type).source || n.redundant || !n.intPump) continue;
    integratedHead = Math.max(integratedHead, (n.pumpHead ?? 0) * 1000);
  }
  const net = Math.max(0, dpCritical - integratedHead);
  const headM = net / (fp.rho * 9.81);
  return {
    dpCritical, integratedHead, net, headM, margin: headM * 1.1,
    flow: totalDemand(scheme, fp), path,
    covered: integratedHead > 0 && net === 0,
  };
}
