// Analiza rețelei: propagarea debitelor la teuri, traseul critic și punctul de funcționare al pompei.
import { flowFromKw, type FluidProps } from "./fluids";
import { circuitTotals, computePipe, type CalcWarning, type PipeResult } from "./hydraulics";
import { getSymbol } from "./symbols";
import { solveNetwork, type SolverOptions, type SolverResult } from "./solver";
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
 * Propagarea se face SEPARAT pe fiecare circuit (tur, retur, agent termic…): altfel
 * un rezervor tampon sau un schimbător, care are porturi pe ambele circuite, ar
 * închide artificial o buclă între tur și retur și niciun debit nu ar mai putea fi dedus.
 * Echipamentele consumatoare și sursele sunt „capete de sarcină": parcurgerea se oprește
 * la ele. Pentru fiecare tronson se compară cele două capete: partea fără sursă dă
 * consumul transportat. Dacă există o cale paralelă reală (inel), debitul rămâne manual.
 */
export function propagateFlows(scheme: Scheme, fp: FluidProps): Map<string, FlowInfo> {
  const out = new Map<string, FlowInfo>();
  const all = scheme.pipes.filter((p) => !p.disabled);
  if (!all.length) return out;

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
    for (const p of all) out.set(p.id, { flow: 0, ambiguous: true, reason: "nicio sursă (chiller) în schemă" });
    return out;
  }

  // grupare pe circuite: tur și retur se rezolvă independent
  const groups = new Map<string, typeof all>();
  for (const p of all) {
    const g = groups.get(p.circuit) ?? [];
    g.push(p);
    groups.set(p.circuit, g);
  }

  for (const pipes of groups.values()) {
    const adj = new Map<string, typeof pipes>();
    for (const p of pipes) {
      for (const id of [p.from.node, p.to.node]) {
        const list = adj.get(id) ?? [];
        list.push(p);
        adj.set(id, list);
      }
    }

    // rădăcinile grupului: sursele proprii sau, în lipsa lor, colectoarele/distribuitoarele
    const inGroup = new Set(adj.keys());
    const roots = new Set<string>([...inGroup].filter((id) => isSource.has(id)));
    if (!roots.size) {
      // circuit secundar fără chiller: rădăcina este nodul de legătură cu restul instalației
      for (const id of inGroup) {
        const other = all.some((p) => p.circuit !== pipes[0]!.circuit && (p.from.node === id || p.to.node === id));
        if (other && !blocked.has(id)) roots.add(id);
      }
    }
    if (!roots.size) {
      for (const id of inGroup) if ((adj.get(id)?.length ?? 0) >= 3) roots.add(id);
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
    const exclusiveRoot = (x: Set<string>, y: Set<string>) => [...x].some((id) => roots.has(id) && !y.has(id));

    for (const p of pipes) {
      const a = reach(p.from.node, p.id);
      if (!blocked.has(p.to.node) && a.has(p.to.node)) {
        out.set(p.id, { flow: 0, ambiguous: true, reason: "tronson de inel (cale paralelă)" });
        continue;
      }
      const b = reach(p.to.node, p.id);
      const ra = exclusiveRoot(a, b), rb = exclusiveRoot(b, a);
      const da = sum(a), db = sum(b);
      let f = 0;
      if (ra && !rb) f = db;
      else if (rb && !ra) f = da;
      else if (da > 0 && db === 0) f = da;
      else if (db > 0 && da === 0) f = db;
      else if (da === 0 && db === 0) f = 0;
      else {
        out.set(p.id, { flow: 0, ambiguous: true, reason: "repartiție neunivocă (buclă)" });
        continue;
      }
      out.set(p.id, { flow: Math.round(f * 100) / 100, ambiguous: false });
    }
  }

  return out;
}


export interface CriticalPath {
  pipes: string[]; // tronsoanele traseului, în ordine
  dp: number; // Pa
  endTag: string; // consumatorul cel mai dezavantajat
  terminal: boolean;
  /** Evaluare a traseului cu pierderea cumulată maximă — NU o soluție de rețea (fără continuitate/bilanț energetic). */
  method: "critical-path-evaluation";
  /** Pierderi pe conducte vs. echipamente/armături de-a lungul traseului critic. */
  dpPipes: number;
  dpComponents: number;
}

/** Traseul hidraulic cu pierderea cumulată maximă, de la sursă la un consumator. */
export function criticalPath(scheme: Scheme, fp: FluidProps): CriticalPath | null {
  const pipes = scheme.pipes.filter((p) => !p.disabled);
  const sources = scheme.nodes.filter((n) => getSymbol(n.type).source && !n.redundant).map((n) => n.id);
  if (!sources.length || !pipes.length) return null;
  const res = new Map(pipes.map((p) => [p.id, computePipe(p, scheme, fp)] as const));
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
    let acc = 0, accP = 0, accC = 0;
    for (const id of used) { const r = res.get(id)!; acc += r.dpTotal; accP += r.dpPipe; accC += r.dpComp; }
    // un traseu care ajunge la un consumator are prioritate față de unul oarecare
    if (!best || (term && !best.terminal) || (term === best.terminal && acc > best.dp)) {
      best = { pipes: [...used], dp: acc, endTag: n?.tag ?? "—", terminal: term, method: "critical-path-evaluation", dpPipes: accP, dpComponents: accC };
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
  /** Estimare preliminară a sarcinii; NU este punctul de funcționare (fără curbă de pompă). */
  kind: "preliminary-duty-estimate";
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
    kind: "preliminary-duty-estimate",
  };
}

/* ------------------------------------------------------------------ */
/* Evaluarea rețelei: statusuri și avertizări                          */
/* ------------------------------------------------------------------ */

export type NetworkStatus = "solved" | "evaluated" | "incomplete" | "unresolved";

export interface NetworkEvaluation {
  /** (a)+(b) rezultate pe fiecare tronson */
  pipes: Map<string, PipeResult>;
  /** (c) traseul critic (evaluare, nu soluție de rețea) */
  critical: CriticalPath | null;
  /** (d) sumar pe circuit (inventar; NU Δp de sistem) */
  circuits: ReturnType<typeof circuitTotals>;
  /** Δp de sistem = Δp pe traseul critic (niciodată suma ramurilor paralele) */
  systemDp: number;
  flows: Map<string, FlowInfo>;
  /** true doar dacă solverul de rețea (continuitate + bilanț energetic) a convers fără erori blocante */
  networkSolved: boolean;
  status: NetworkStatus;
  /** Rezultatul solverului de rețea (Hardy-Cross). */
  solution: SolverResult;
  warnings: CalcWarning[];
}

export function evaluateNetwork(scheme: Scheme, fp: FluidProps, opts?: SolverOptions): NetworkEvaluation {
  const active = scheme.pipes.filter((p) => !p.disabled);
  const pipes = new Map(active.map((p) => [p.id, computePipe(p, scheme, fp)] as const));
  const flows = propagateFlows(scheme, fp);
  const critical = criticalPath(scheme, fp);
  const warnings: CalcWarning[] = [];
  if (fp.source === "engineering-estimate" && scheme.fluid !== "water") {
    warnings.push({ code: "approx_fluid_props", message: "Proprietăți glicol din corelații aproximative (estimare inginerească, ±3–8%)" });
  }
  const seen = new Set<string>();
  for (const r of pipes.values()) for (const w of r.warnings) {
    const key = w.code + (w.target ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(w);
  }
  let unresolved = false;
  for (const p of active) {
    const fi = flows.get(p.id);
    if (!fi) continue;
    if (fi.ambiguous) {
      unresolved = true;
      warnings.push({ code: "flow_unresolved", message: `${p.tag}: debit nedeterminat (${fi.reason ?? "ambiguu"})`, target: p.id });
    } else if (fi.flow > 0 && Math.abs(fi.flow - p.flow) > 0.01) {
      warnings.push({ code: "manual_flow_auto_available", message: `${p.tag}: debit manual ${p.flow} m³/h ≠ dedus ${fi.flow} m³/h`, target: p.id });
    }
  }
  const incomplete = [...pipes.values()].some((r) => r.status === "incomplete");
  const solution = solveNetwork(scheme, fp, opts);
  // tronsoanele de inel nedeductibile prin propagare sunt rezolvate de solver dacă acesta converge
  if (solution.converged) unresolved = false;
  for (const w of solution.warnings) if (w.severity === "error" || ["not_converged", "multi_source_split", "source_inferred", "r_over_limit", "terminal_flow_inconsistent", "source_demand_mismatch", "equipment_dp_no_ref", "isolated_node", "source_head_unknown"].includes(w.code)) warnings.push(w);
  const final = solution.converged ? warnings.filter((w) => w.code !== "flow_unresolved") : warnings;
  return {
    pipes, critical, circuits: circuitTotals(scheme, fp),
    systemDp: solution.networkSolved ? solution.systemDp : critical?.dp ?? 0,
    flows,
    networkSolved: solution.networkSolved,
    status: solution.networkSolved ? "solved" : solution.status === "unresolved" || unresolved ? "unresolved" : incomplete || solution.status === "incomplete" ? "incomplete" : "evaluated",
    solution,
    warnings: final,
  };
}
