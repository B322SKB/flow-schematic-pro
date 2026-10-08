/**
 * Solver hidraulic de rețea (Sprint 2) — preliminar.
 *
 * METODĂ
 *  - Fiecare circuit (tur, retur, glicol…) se rezolvă separat, pe componente conexe.
 *    Nodurile grafului sunt elementele schemei; laturile sunt tronsoanele active.
 *  - Sursa (chiller activ; în lipsă, nodul de legătură cu alt circuit) injectează debitul cerut,
 *    terminalele îl extrag (debit explicit sau din kW/ΔT). Pentru circuitele de retur
 *    (return, glycol_r) sensul fizic este inversat: se rezolvă în convenția tur și se inversează semnul.
 *  - Debit inițial: arbore de acoperire (BFS din sursă) — continuitatea este satisfăcută exact,
 *    corzile pornesc cu Q = 0 (nicio presupunere 50/50).
 *  - Buclele fundamentale (o coardă + calea în arbore) sunt corectate iterativ prin Hardy-Cross:
 *      ΔQ = −Σ s·h(Q) / Σ h'(Q),  h(Q) = sign(Q)·Δp(|Q|)
 *    Δp(|Q|) = Darcy-Weisbach (Colebrook / 64/Re) + ΣK·ρv²/2 + echipament, adică ≈ R(Q)·Q².
 *    Corecția buclei păstrează continuitatea; debitul poate schimba semnul între iterații.
 *
 * CONVENȚIA DE SEMNE
 *  - Q > 0: curgere în sensul desenării (from → to); Q < 0: sens invers.
 *  - Velocity și pierderile folosesc |Q|; semnul intră doar în bilanțurile de nod și de buclă.
 *
 * CRITERIU DE CONVERGENȚĂ
 *  - max |Σ s·h| pe toate buclele < tolPa (implicit 1 Pa) ȘI max |ΔQ| < tolFlow (implicit 1e-4 m³/h),
 *    în cel mult maxIterations (implicit 200). Altfel: not_converged, rezultatul nu este valid.
 *
 * ELEVAȚIE: circuit închis — termenul ρ·g·Δz se anulează pe orice buclă închisă, deci nu se adaugă.
 */
import { flowFromKw, type FluidProps } from "./fluids";
import { computePipe, type CalcWarning, type PipeResult } from "./hydraulics";
import { getSymbol } from "./symbols";
import type { Pipe, Scheme } from "./types";
import { maxR } from "./velocity";
import { nodeDemand } from "./network";

export interface SolverOptions {
  tolPa?: number;
  tolFlow?: number; // m³/h
  maxIterations?: number;
}

export interface SolvedPipe extends PipeResult {
  /** debit cu semn față de sensul desenării [m³/h] */
  flowSigned: number;
  direction: "forward" | "reverse" | "none";
}

export interface TerminalFlow { id: string; tag: string; flow: number; dpFromSource: number }

export interface SolverResult {
  networkSolved: boolean;
  converged: boolean;
  iterations: number;
  maxContinuityError: number; // m³/h
  maxEnergyError: number; // Pa
  sourceFlow: number; // m³/h (debitul total al surselor, circuitele tur)
  terminals: TerminalFlow[];
  systemDp: number; // Pa – pe traseul critic, din starea convergentă
  critical: { pipes: string[]; endTag: string; dp: number } | null;
  loops: number;
  pipes: Map<string, SolvedPipe>;
  unresolvedPipes: string[];
  status: "solved" | "evaluated" | "incomplete" | "unresolved";
  warnings: CalcWarning[];
}

const RETURN = new Set(["return", "glycol_r"]);
const EPS = 1e-3; // m³/h pentru derivata la debit ~0

export function solveNetwork(scheme: Scheme, fp: FluidProps, opts: SolverOptions = {}): SolverResult {
  const tolPa = opts.tolPa ?? 1;
  const tolFlow = opts.tolFlow ?? 1e-4;
  const maxIt = opts.maxIterations ?? 200;
  const warnings: CalcWarning[] = [];
  const err = (code: CalcWarning["code"], message: string, target?: string) => warnings.push({ code, message, target, severity: "error" });
  const warn = (code: CalcWarning["code"], message: string, target?: string, severity: CalcWarning["severity"] = "warning") =>
    warnings.push({ code, message, target, severity });

  const nodeById = new Map(scheme.nodes.map((n) => [n.id, n] as const));
  const valid: Pipe[] = [];
  for (const p of scheme.pipes) {
    if (p.disabled) continue;
    if (!nodeById.has(p.from.node) || !nodeById.has(p.to.node) || p.from.node === p.to.node) {
      err("invalid_pipe_end", `${p.tag}: conductă fără capăt valid`, p.id);
      continue;
    }
    valid.push(p);
  }
  const connected = new Set(valid.flatMap((p) => [p.from.node, p.to.node]));
  for (const n of scheme.nodes) {
    if (getSymbol(n.type).ports.length && !connected.has(n.id)) warn("isolated_node", `${n.tag}: element neconectat`, n.id, "info");
  }

  const demand = new Map(scheme.nodes.map((n) => [n.id, nodeDemand(n, scheme, fp)] as const));
  let sources = scheme.nodes.filter((n) => getSymbol(n.type).source && !n.redundant).map((n) => n.id);
  if (!sources.length) sources = scheme.nodes.filter((n) => getSymbol(n.type).source).map((n) => n.id);
  const isSource = new Set(sources);
  if (!sources.length && valid.length) err("no_source", "Rețea fără sursă (chiller)");

  // diagnostice pe terminale
  for (const n of scheme.nodes) {
    const sym = getSymbol(n.type);
    if (!sym.terminal || n.redundant) continue;
    if (n.flow && n.kw) {
      const q = flowFromKw(n.kw, n.deltaT ?? scheme.deltaT, fp);
      if (q > 0 && Math.abs(q - n.flow) / q > 0.05) warn("terminal_flow_inconsistent", `${n.tag}: debit ${n.flow} m³/h ≠ ${q} m³/h din kW/ΔT`, n.id);
    }
  }

  const pipesOut = new Map<string, SolvedPipe>();
  const unresolved = new Set<string>();
  const nodeDp = new Map<string, number>(); // id terminal -> Δp cumulat (toate circuitele)
  const nodePath = new Map<string, string[]>();
  let iterations = 0, maxCont = 0, maxEnergy = 0, loopsTotal = 0, converged = true, sourceFlow = 0;
  let missingHead = true;
  for (const id of sources) if (nodeById.get(id)?.intPump && nodeById.get(id)?.pumpHead) missingHead = false;
  if (scheme.nodes.some((n) => getSymbol(n.type).category === "Pompe")) missingHead = false;

  const groups = new Map<string, Pipe[]>();
  for (const p of valid) groups.set(p.circuit, [...(groups.get(p.circuit) ?? []), p]);

  for (const [circuit, cps] of groups) {
    const flip = RETURN.has(circuit) ? -1 : 1;
    const adj = new Map<string, number[]>();
    cps.forEach((p, i) => {
      for (const id of [p.from.node, p.to.node]) adj.set(id, [...(adj.get(id) ?? []), i]);
    });
    const visitedAll = new Set<string>();
    for (const start of adj.keys()) {
      if (visitedAll.has(start)) continue;
      // componentă conexă
      const comp: string[] = [];
      const st = [start];
      visitedAll.add(start);
      while (st.length) {
        const id = st.pop()!;
        comp.push(id);
        for (const ei of adj.get(id) ?? []) {
          const p = cps[ei]!;
          const nb = p.from.node === id ? p.to.node : p.from.node;
          if (!visitedAll.has(nb)) { visitedAll.add(nb); st.push(nb); }
        }
      }
      const compSet = new Set(comp);
      const edges = cps.map((p, i) => ({ p, i })).filter(({ p }) => compSet.has(p.from.node));
      const terms = comp.filter((id) => (demand.get(id) ?? 0) > 0);
      const totalDem = terms.reduce((s, id) => s + demand.get(id)!, 0);
      let srcs = comp.filter((id) => isSource.has(id));
      if (!srcs.length) {
        const link = comp.find((id) => {
          const sym = getSymbol(nodeById.get(id)!.type);
          return !sym.terminal && valid.some((p) => p.circuit !== circuit && (p.from.node === id || p.to.node === id));
        });
        if (link && totalDem > 0) {
          srcs = [link];
          warn("source_inferred", `Circuit ${circuit}: fără sursă proprie, alimentare presupusă prin ${nodeById.get(link)!.tag}`, link, "info");
        } else if (totalDem > 0) {
          for (const t of terms) err("terminal_no_path", `${nodeById.get(t)!.tag}: terminal fără cale la sursă`, t);
          for (const { p } of edges) unresolved.add(p.id);
          continue;
        }
      }
      if (srcs.length > 1) warn("multi_source_split", `Preliminary – equal split fallback: circuit ${circuit}, ${srcs.length} surse în paralel — debit împărțit egal (fără curbe de pompă)`);
      const inj = new Map<string, number>();
      for (const t of terms) inj.set(t, -(demand.get(t) ?? 0));
      for (const s of srcs) inj.set(s, (inj.get(s) ?? 0) + (srcs.length ? totalDem / srcs.length : 0));
      if (flip === 1) sourceFlow += totalDem;
      const root = srcs[0] ?? comp[0]!;

      // arbore de acoperire (BFS)
      const parentEdge = new Map<string, number>();
      const parent = new Map<string, string>();
      const order: string[] = [root];
      const seen = new Set([root]);
      const treeEdges = new Set<number>();
      for (let k = 0; k < order.length; k++) {
        const id = order[k]!;
        for (const ei of adj.get(id) ?? []) {
          const p = cps[ei]!;
          const nb = p.from.node === id ? p.to.node : p.from.node;
          if (seen.has(nb)) continue;
          seen.add(nb); order.push(nb); parent.set(nb, id); parentEdge.set(nb, ei); treeEdges.add(ei);
        }
      }
      // debite inițiale (convenție tur): Q pe latura părinte→copil = consumul net al subarborelui
      const Q = new Map<number, number>(edges.map(({ i }) => [i, 0]));
      const sub = new Map<string, number>();
      for (let k = order.length - 1; k > 0; k--) {
        const id = order[k]!;
        const s = (sub.get(id) ?? 0) - (inj.get(id) ?? 0);
        const ei = parentEdge.get(id)!;
        const p = cps[ei]!;
        Q.set(ei, p.from.node === parent.get(id) ? s : -s);
        const par = parent.get(id)!;
        sub.set(par, (sub.get(par) ?? 0) + s);
      }

      // bucle fundamentale
      const pathToRoot = (id: string) => { const r = [id]; while (parent.has(r[r.length - 1]!)) r.push(parent.get(r[r.length - 1]!)!); return r; };
      const loops: { e: number; s: number }[][] = [];
      for (const { p, i } of edges) {
        if (treeEdges.has(i)) continue;
        const u = p.from.node, v = p.to.node;
        const pu = pathToRoot(u), pv = pathToRoot(v);
        const setU = new Set(pu);
        const lca = pv.find((x) => setU.has(x))!;
        const loop = [{ e: i, s: 1 }]; // u → v pe coardă
        // v → lca
        for (let x = v; x !== lca; x = parent.get(x)!) {
          const ei = parentEdge.get(x)!;
          loop.push({ e: ei, s: cps[ei]!.from.node === x ? 1 : -1 });
        }
        // lca → u
        const down: { e: number; s: number }[] = [];
        for (let x = u; x !== lca; x = parent.get(x)!) {
          const ei = parentEdge.get(x)!;
          down.push({ e: ei, s: cps[ei]!.from.node === parent.get(x) ? 1 : -1 });
        }
        loops.push([...loop, ...down.reverse()]);
      }
      loopsTotal += loops.length;

      // Δp(|Q|) cu referința echipamentului
      const refOf = (p: Pipe) => {
        const d = demand.get(p.to.node) ?? 0;
        return d > 0 ? d : p.flow > 0 ? p.flow : undefined;
      };
      const loopEdges = new Set(loops.flat().map((x) => x.e));
      for (const ei of loopEdges) {
        const p = cps[ei]!;
        const r = computePipe(p, scheme, fp, { flow: 1 });
        if (r.warnings.some((w) => w.code === "missing_dn" || w.code === "missing_material")) {
          err("loop_insufficient_data", `${p.tag}: buclă fără date suficiente (DN/material)`, p.id);
        }
        const t = nodeById.get(p.to.node);
        if (t?.dpFixed && !refOf(p)) warn("equipment_dp_no_ref", `${t.tag}: Δp fix fără debit de referință — tratat constant`, t.id);
      }
      const dpAbs = (ei: number, q: number) => computePipe(cps[ei]!, scheme, fp, { flow: Math.abs(q), compRefFlow: refOf(cps[ei]!) }).dpTotal;
      const h = (ei: number, q: number) => Math.sign(q) * dpAbs(ei, q);
      const dh = (ei: number, q: number) => {
        const a = Math.abs(q);
        if (a < EPS) return Math.max(dpAbs(ei, EPS) / EPS, 1e-6);
        return Math.max((dpAbs(ei, a * 1.001) - dpAbs(ei, a * 0.999)) / (a * 0.002), 1e-6);
      };

      let compConverged = loops.length === 0;
      let it = 0;
      let lastRes = 0;
      if (loops.length && !warnings.some((w) => w.code === "loop_insufficient_data" && w.severity === "error")) {
        for (it = 1; it <= maxIt; it++) {
          let maxH = 0, maxDQ = 0;
          for (const L of loops) {
            let H = 0, D = 0;
            for (const { e, s } of L) { const q = Q.get(e)!; H += s * h(e, q); D += dh(e, q); }
            const dQ = -H / D;
            for (const { e, s } of L) Q.set(e, Q.get(e)! + s * dQ);
            maxH = Math.max(maxH, Math.abs(H));
            maxDQ = Math.max(maxDQ, Math.abs(dQ));
          }
          // reziduu după corecție
          lastRes = 0;
          for (const L of loops) {
            let H = 0;
            for (const { e, s } of L) H += s * h(e, Q.get(e)!);
            lastRes = Math.max(lastRes, Math.abs(H));
          }
          if (lastRes < tolPa && maxDQ < tolFlow) { compConverged = true; break; }
        }
        iterations = Math.max(iterations, Math.min(it, maxIt));
      }
      maxEnergy = Math.max(maxEnergy, lastRes);
      if (!compConverged) {
        converged = false;
        err("not_converged", `Circuit ${circuit}: solverul nu a convers în ${maxIt} iterații (reziduu ${lastRes.toFixed(1)} Pa)`);
        for (const L of loops) for (const { e } of L) unresolved.add(cps[e]!.id);
      }

      // eroare de continuitate
      for (const id of comp) {
        let s = inj.get(id) ?? 0;
        for (const ei of adj.get(id) ?? []) { const p = cps[ei]!; s += p.to.node === id ? Q.get(ei)! : -Q.get(ei)!; }
        maxCont = Math.max(maxCont, Math.abs(s));
      }

      // rezultate pe tronson (sens fizic: flip pentru retur)
      for (const { p, i } of edges) {
        const q = Q.get(i)! * flip;
        const r = computePipe(p, scheme, fp, { flow: Math.abs(q), compRefFlow: refOf(p) });
        if (r.R > maxR(scheme) && Math.abs(q) > 0) r.warnings.push({ code: "r_over_limit", message: `R=${r.R.toFixed(0)} Pa/m peste limită`, target: p.id });
        const qs = Math.round(q * 1e4) / 1e4;
        pipesOut.set(p.id, { ...r, flowSigned: qs, direction: Math.abs(qs) < 1e-4 ? "none" : qs > 0 ? "forward" : "reverse" });
      }

      // presiuni relative în nod (pe arbore) → Δp sursă→terminal
      const P = new Map<string, number>([[root, 0]]);
      const paths = new Map<string, string[]>([[root, []]]);
      for (let k = 1; k < order.length; k++) {
        const id = order[k]!, par = parent.get(id)!, ei = parentEdge.get(id)!;
        const s = cps[ei]!.from.node === par ? 1 : -1;
        P.set(id, P.get(par)! - s * h(ei, Q.get(ei)!));
        paths.set(id, [...paths.get(par)!, cps[ei]!.id]);
      }
      const ends = terms.length ? terms : comp;
      for (const t of ends) {
        const dp = Math.max(0, -(P.get(t) ?? 0));
        nodeDp.set(t, (nodeDp.get(t) ?? 0) + dp);
        nodePath.set(t, [...(nodePath.get(t) ?? []), ...(paths.get(t) ?? [])]);
      }
    }
  }

  // traseu critic: terminalul cu Δp cumulat maxim (tur + retur)
  const termIds = [...nodeDp.keys()].filter((id) => (demand.get(id) ?? 0) > 0);
  const pool = termIds.length ? termIds : [...nodeDp.keys()];
  let critical: SolverResult["critical"] = null;
  for (const id of pool) {
    const dp = nodeDp.get(id)!;
    if (!critical || dp > critical.dp) critical = { pipes: nodePath.get(id) ?? [], endTag: nodeById.get(id)?.tag ?? "—", dp };
  }
  const terminals: TerminalFlow[] = scheme.nodes
    .filter((n) => getSymbol(n.type).terminal)
    .map((n) => ({ id: n.id, tag: n.tag, flow: demand.get(n.id) ?? 0, dpFromSource: nodeDp.get(n.id) ?? 0 }));

  // sursă vs cerere
  for (const id of sources) {
    const n = nodeById.get(id)!;
    if (n.flow && sourceFlow > 0 && Math.abs(n.flow - sourceFlow) / sourceFlow > 0.1) {
      warn("source_demand_mismatch", `${n.tag}: debit nominal ${n.flow} m³/h ≠ cerere ${sourceFlow.toFixed(2)} m³/h`, id);
    }
  }
  if (missingHead && valid.length) warn("source_head_unknown", "Presiunea disponibilă a sursei nu este definită — Δp sistem este cerința, nu un punct de funcționare", undefined, "info");
  if (fp.source === "engineering-estimate" && scheme.fluid !== "water") warn("approx_fluid_props", "Proprietăți glicol aproximative (estimare inginerească)");
  for (const r of pipesOut.values()) for (const w of r.warnings) warnings.push(w);

  const blocking = warnings.some((w) => w.severity === "error");
  const incomplete = [...pipesOut.values()].some((r) => r.warnings.some((w) => w.code === "missing_dn" || w.code === "missing_material"));
  const networkSolved = converged && !blocking && valid.length > 0;
  const status: SolverResult["status"] = !converged || unresolved.size ? "unresolved" : blocking || incomplete ? "incomplete" : networkSolved ? "solved" : "evaluated";
  return {
    networkSolved, converged, iterations, maxContinuityError: maxCont, maxEnergyError: maxEnergy,
    sourceFlow, terminals, systemDp: critical?.dp ?? 0, critical, loops: loopsTotal,
    pipes: pipesOut, unresolvedPipes: [...unresolved], status, warnings,
  };
}
