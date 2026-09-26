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
  reason?: string | undefined; // explicație când debitul nu poate fi dedus
}

/**
 * Legea I a lui Kirchhoff, independent de sensul în care au fost trasate conductele.
 * Echipamentele consumatoare și sursele sunt „capete de sarcină": parcurgerea se
 * oprește la ele, deci tur și retur nu se scurtcircuitează prin interiorul unui CCU.
 * Pentru fiecare tronson se compară cele două capete: partea fără sursă dă consumul
 * transportat. Dacă există o cale paralelă reală (inel), debitul rămâne manual.
 */
export function propagateFlows(scheme: Scheme, fp: FluidProps): Map<string, FlowInfo> {
  const out = new Map<string, FlowInfo>();
  const pipes = scheme.pipes.filter((p) => !p.disabled);
  if (!pipes.length) return out;

  const demand = new Map<string, number>();
  const isSource = new Set<string>(); // surse active (cele redundante nu debitează)
  const anySource = new Set<string>();
  const blocked = new Set<string>(); // noduri prin care circuitul nu se traversează
  for (const n of scheme.nodes) {
    const sym = getSymbol(n.type);
    demand.set(n.id, nodeDemand(n, scheme, fp));
    if (sym.source) {
      anySource.add(n.id);
      if (!n.redundant) isSource.add(n.id);
    }
    if (sym.source || sym.terminal) blocked.add(n.id);
  }
  if (!isSource.size) for (const id of anySource) isSource.add(id);
  if (!isSource.size) {
    for (const p of pipes) out.set(p.id, { flow: 0, ambiguous: true, reason: "nicio sursă (chiller) în schemă" });
    return out;
  }




  const adj = new Map<string, typeof pipes>();
  for (const p of pipes) {
    for (const id of [p.from.node, p.to.node]) {
      const list = adj.get(id) ?? [];
      list.push(p);
      adj.set(id, list);
    }
  }

  /** Nodurile atinse dinspre `start`, fără tronsonul `skip`, oprind la echipamente/surse. */
  const reach = (start: string, skip: string) => {
    const seen = new Set<string>([start]);
    const q: string[] = [];
    if (!blocked.has(start)) q.push(start);
    while (q.length) {
      const id = q.shift()!;
      for (const p of adj.get(id) ?? []) {
        if (p.id === skip) continue;
        const nb = p.from.node === id ? p.to.node : p.from.node;
        if (seen.has(nb)) continue;
        seen.add(nb);
        if (!blocked.has(nb)) q.push(nb);
      }
    }
    return seen;
  };
  const sum = (ids: Set<string>) => {
    let f = 0;
    for (const id of ids) f += demand.get(id) ?? 0;
    return f;
  };
  /** Sursele accesibile exclusiv dintr-un capăt (buclele închise ating aceeași sursă din ambele capete). */
  const exclusiveSource = (x: Set<string>, y: Set<string>) =>
    [...x].some((id) => isSource.has(id) && !y.has(id));

  for (const p of pipes) {
    const a = reach(p.from.node, p.id);
    if (!blocked.has(p.to.node) && a.has(p.to.node)) {
      out.set(p.id, { flow: 0, ambiguous: true, reason: "tronson de inel (cale paralelă)" });
      continue;
    }
    const b = reach(p.to.node, p.id);
    const sa = exclusiveSource(a, b), sb = exclusiveSource(b, a);
    const da = sum(a), db = sum(b);
    let f = 0;
    let reason: string | undefined;
    if (sa && !sb) f = db;
    else if (sb && !sa) f = da;
    else if (da > 0 && db === 0) f = da;
    else if (db > 0 && da === 0) f = db;
    else if (da === 0 && db === 0) f = 0;
    else {
      out.set(p.id, { flow: 0, ambiguous: true, reason: "repartiție neunivocă (buclă)" });
      continue;
    }
    out.set(p.id, { flow: Math.round(f * 100) / 100, ambiguous: false, reason });
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
