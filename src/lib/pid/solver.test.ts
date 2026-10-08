import { describe, expect, it } from "vitest";
import type { FluidProps } from "./fluids";
import { solveNetwork } from "./solver";
import { evaluateNetwork } from "./network";
import type { PidNode, Pipe, Scheme } from "./types";

const FP: FluidProps = { rho: 1000, mu: 1e-3, nu: 1e-6, cp: 4200, freeze: 0, source: "engineering-estimate" };
const node = (id: string, type: string, x: number, y: number, extra: Partial<PidNode> = {}): PidNode =>
  ({ id, type, tag: id, x, y, rotation: 0, ...extra });
const pipe = (id: string, from: [string, string], to: [string, string], length: number, flow = 0, extra: Partial<Pipe> = {}): Pipe => ({
  id, tag: id, from: { node: from[0], port: from[1] }, to: { node: to[0], port: to[1] },
  dn: 50, material: "steel_carbon", joint: "welded", circuit: "supply", length, flow,
  flowMode: "manual", routing: "auto", fittings: {}, ...extra,
});
const scheme = (nodes: PidNode[], pipes: Pipe[]): Scheme => ({
  id: "t", name: "t", nodes, pipes, fluid: "water", concentration: 0, temperature: 10, deltaT: 5,
  circuitColors: {}, customSymbols: [], revision: "A", updatedAt: 0,
});
const q = (r: ReturnType<typeof solveNetwork>, id: string) => r.pipes.get(id)!.flowSigned;

/** Reziduul energetic pe bucla T1→(a)→T2←(b)←T1 calculat independent din rezultate. */
const loopResidual = (r: ReturnType<typeof solveNetwork>, legs: { id: string; s: 1 | -1 }[]) =>
  legs.reduce((acc, { id, s }) => { const p = r.pipes.get(id)!; return acc + s * Math.sign(p.flowSigned) * p.dpTotal; }, 0);

const parallel = (len1: number, len2: number, reverse2 = false) => scheme(
  [node("CH", "chiller", 0, 0), node("T1", "tee", 200, 0), node("T2", "tee", 500, 0), node("A", "ccu", 800, 0, { flow: 10, dpFixed: 20 })],
  [
    pipe("S", ["CH", "c"], ["T1", "a"], 5),
    pipe("L1", ["T1", "b"], ["T2", "a"], len1),
    reverse2 ? pipe("L2", ["T2", "c"], ["T1", "c"], len2) : pipe("L2", ["T1", "c"], ["T2", "c"], len2),
    pipe("E", ["T2", "b"], ["A", "a"], 5),
  ],
);

describe("Solver de rețea (Hardy-Cross)", () => {
  it("A. radial: debitul se propagă corect", () => {
    const s = scheme([node("CH", "chiller", 0, 0), node("T", "tee", 300, 0), node("A", "ccu", 600, 0, { flow: 7.5, dpFixed: 10 })],
      [pipe("P1", ["CH", "c"], ["T", "a"], 10), pipe("P2", ["T", "b"], ["A", "a"], 10)]);
    const r = solveNetwork(s, FP);
    expect(r.networkSolved).toBe(true);
    expect(r.loops).toBe(0);
    expect(q(r, "P1")).toBeCloseTo(7.5, 6);
    expect(q(r, "P2")).toBeCloseTo(7.5, 6);
    expect(r.sourceFlow).toBeCloseTo(7.5, 6);
  });

  const branched = scheme(
    [node("CH", "chiller", 0, 0), node("T", "tee", 300, 0), node("A", "ccu", 600, 0, { flow: 10, dpFixed: 30 }), node("B", "ccu", 300, 300, { flow: 6, dpFixed: 30 })],
    [pipe("P1", ["CH", "c"], ["T", "a"], 10, 0, { dn: 65 }), pipe("P2", ["T", "b"], ["A", "a"], 80), pipe("P3", ["T", "c"], ["B", "a"], 5)],
  );

  it("B. ramificat: continuitate la teu", () => {
    const r = solveNetwork(branched, FP);
    expect(q(r, "P1")).toBeCloseTo(q(r, "P2") + q(r, "P3"), 9);
    expect(q(r, "P2")).toBeCloseTo(10, 6);
    expect(q(r, "P3")).toBeCloseTo(6, 6);
    expect(r.maxContinuityError).toBeLessThan(1e-9);
  });

  it("C. paralele cu rezistențe diferite: distribuție inegală, nu 50/50", () => {
    const r = solveNetwork(parallel(20, 80), FP);
    expect(r.converged).toBe(true);
    const q1 = q(r, "L1"), q2 = q(r, "L2");
    expect(q1 + q2).toBeCloseTo(10, 4);
    expect(q1 / q2).toBeGreaterThan(1.6); // ≈ √(80/20)=2 corectat pentru f(Re) și pierderi locale
    expect(q1 / q2).toBeLessThan(2.2);
  });

  it("D. buclă simplă: converge, bilanțul pe buclă ≈ 0", () => {
    const r = solveNetwork(parallel(30, 30), FP);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.maxEnergyError).toBeLessThan(1);
    expect(Math.abs(loopResidual(r, [{ id: "L1", s: 1 }, { id: "L2", s: -1 }]))).toBeLessThan(1);
  });

  it("E. inel cu două terminale și rezistențe diferite: sensurile se ajustează", () => {
    const s = scheme(
      [node("CH", "chiller", 0, 0), node("N1", "tee", 200, 0), node("N2", "tee", 500, 0), node("N3", "tee", 800, 0),
        node("A", "ccu", 500, 300, { flow: 5, dpFixed: 20 }), node("B", "ccu", 800, 300, { flow: 10, dpFixed: 20 })],
      [
        pipe("S", ["CH", "c"], ["N1", "a"], 5, 0, { dn: 65 }),
        pipe("R12", ["N1", "b"], ["N2", "a"], 10),
        pipe("R23", ["N2", "b"], ["N3", "a"], 10),
        pipe("R13", ["N1", "c"], ["N3", "b"], 100),
        pipe("EA", ["N2", "c"], ["A", "a"], 3),
        pipe("EB", ["N3", "c"], ["B", "a"], 3),
      ],
    );
    const r = solveNetwork(s, FP);
    expect(r.converged).toBe(true);
    expect(r.maxContinuityError).toBeLessThan(1e-6);
    expect(r.maxEnergyError).toBeLessThan(1);
    expect(q(r, "R12") + q(r, "R13")).toBeCloseTo(15, 4);
    expect(q(r, "R23")).toBeGreaterThan(0); // calea scurtă alimentează și B
    expect(q(r, "R12")).toBeGreaterThan(q(r, "R13"));
    expect(r.pipes.get("R23")!.direction).toBe("forward");
  });

  it("F. neconvergent sau fără sursă: networkSolved=false, unresolved, avertizare clară", () => {
    const r = solveNetwork(parallel(20, 80), FP, { maxIterations: 1, tolPa: 1e-12, tolFlow: 1e-12 });
    expect(r.networkSolved).toBe(false);
    expect(r.status).toBe("unresolved");
    expect(r.warnings.some((w) => w.code === "not_converged" && w.severity === "error")).toBe(true);

    const ns = scheme([node("T", "tee", 0, 0), node("A", "ccu", 300, 0, { flow: 5 })], [pipe("P", ["T", "b"], ["A", "a"], 5)]);
    const r2 = solveNetwork(ns, FP);
    expect(r2.networkSolved).toBe(false);
    expect(r2.warnings.some((w) => w.code === "no_source" && w.severity === "error")).toBe(true);
    expect(r2.warnings.some((w) => w.code === "terminal_no_path")).toBe(true);
  });

  it("G. Δp sistem NU este suma tuturor ramurilor (ramificat și buclă)", () => {
    const r = solveNetwork(branched, FP);
    const sum = [...r.pipes.values()].reduce((a, p) => a + p.dpTotal, 0);
    expect(r.critical?.pipes).toEqual(["P1", "P2"]);
    expect(r.systemDp).toBeCloseTo(r.pipes.get("P1")!.dpTotal + r.pipes.get("P2")!.dpTotal, 3);
    expect(r.systemDp).toBeLessThan(sum);
    const rl = solveNetwork(parallel(20, 80), FP);
    const suml = [...rl.pipes.values()].reduce((a, p) => a + p.dpTotal, 0);
    expect(rl.systemDp).toBeLessThan(suml);
    // pe bucla convergentă ambele căi dau același Δp
    const viaL1 = ["S", "L1", "E"].reduce((a, id) => a + rl.pipes.get(id)!.dpTotal, 0);
    expect(rl.systemDp).toBeCloseTo(viaL1, -1);
    expect(evaluateNetwork(branched, FP).systemDp).toBeCloseTo(r.systemDp, 3);
  });

  it("H. echipament cu dpFixed inclus în bilanț", () => {
    const s = scheme([node("CH", "chiller", 0, 0), node("A", "ccu", 600, 0, { flow: 10, dpFixed: 30 })], [pipe("P", ["CH", "c"], ["A", "a"], 10)]);
    const r = solveNetwork(s, FP);
    expect(r.pipes.get("P")!.dpComp).toBeCloseTo(30000, 3);
    expect(r.systemDp).toBeGreaterThan(30000);
  });

  it("I. Re în tranziție → avertizare, nu rezultat definitiv", () => {
    const s = scheme([node("CH", "chiller", 0, 0), node("A", "ccu", 600, 0, { flow: 0.15, dpFixed: 5 })], [pipe("P", ["CH", "c"], ["A", "a"], 5, 0, { dn: 20 })]);
    const r = solveNetwork(s, FP);
    expect(r.pipes.get("P")!.regime).toBe("tranziție");
    expect(r.warnings.some((w) => w.code === "transitional_re")).toBe(true);
  });

  it("J. debit negativ pe un tronson desenat invers", () => {
    const r = solveNetwork(parallel(20, 80, true), FP);
    expect(r.converged).toBe(true);
    expect(q(r, "L2")).toBeLessThan(0);
    expect(r.pipes.get("L2")!.direction).toBe("reverse");
    expect(q(r, "L1") - q(r, "L2")).toBeCloseTo(10, 4);
    expect(r.pipes.get("L2")!.v).toBeGreaterThan(0); // viteza pe |Q|
  });

  it("circuitul de retur are sensul fizic inversat", () => {
    const s = scheme([node("CH", "chiller", 0, 0), node("A", "ccu", 600, 0, { flow: 4, dpFixed: 10 })], [pipe("R", ["CH", "d"], ["A", "b"], 10, 0, { circuit: "return" })]);
    const r = solveNetwork(s, FP);
    expect(q(r, "R")).toBeCloseTo(-4, 6);
  });
});
