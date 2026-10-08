import { describe, expect, it } from "vitest";
import { flowFromKw, fluidProps, type FluidProps } from "./fluids";
import {
  colebrook, computePipe, countDirectionChanges, darcyDp, localLoss, regimeOf, reynolds,
  selectDn, unitLoss, velocity, autoBends,
} from "./hydraulics";
import { criticalPath, evaluateNetwork, propagateFlows } from "./network";
import { limitsFor } from "./velocity";
import { DN_LIST, getMaterial } from "./catalog";
import type { PidNode, Pipe, Scheme } from "./types";

const FP: FluidProps = { rho: 1000, mu: 1e-3, nu: 1e-6, cp: 4200, freeze: 0, source: "engineering-estimate" };

const node = (id: string, type: string, x: number, y: number, extra: Partial<PidNode> = {}): PidNode =>
  ({ id, type, tag: id, x, y, rotation: 0, ...extra });
const pipe = (id: string, from: [string, string], to: [string, string], length: number, flow: number, extra: Partial<Pipe> = {}): Pipe => ({
  id, tag: id, from: { node: from[0], port: from[1] }, to: { node: to[0], port: to[1] },
  dn: 50, material: "steel_carbon", joint: "welded", circuit: "supply", length, flow,
  flowMode: "manual", routing: "auto", fittings: {}, ...extra,
});
const scheme = (nodes: PidNode[], pipes: Pipe[]): Scheme => ({
  id: "t", name: "t", nodes, pipes, fluid: "water", concentration: 0, temperature: 10, deltaT: 5,
  circuitColors: {}, customSymbols: [], revision: "A", updatedAt: 0,
});

describe("primitive", () => {
  it("flowFromKw: 100 kW, ΔT 5 K, ρ=1000, cp=4200 → 17.14 m³/h", () => {
    expect(flowFromKw(100, 5, FP)).toBeCloseTo(17.14, 2);
  });
  it("velocity: 10 m³/h în d=50 mm → 1.4147 m/s", () => {
    expect(velocity(10, 0.05)).toBeCloseTo(1.41471, 4);
  });
  it("Reynolds: v=1, d=0.05, ν=1e-6 → 50 000", () => {
    expect(reynolds(1, 0.05, 1e-6)).toBeCloseTo(50000, 6);
    expect(regimeOf(1000)).toBe("laminar");
    expect(regimeOf(3000)).toBe("tranziție");
    expect(regimeOf(50000)).toBe("turbulent");
  });
  it("Darcy: f=0.02, L=10, d=0.05, v=1 → 2000 Pa", () => {
    expect(darcyDp(0.02, 10, 0.05, 1000, 1)).toBeCloseTo(2000, 6);
  });
  it("Colebrook: Re=1e5, ε/D=1e-4 → f≈0.0185 și satisface ecuația", () => {
    const f = colebrook(1e5, 1e-4);
    expect(f).toBeGreaterThan(0.0183);
    expect(f).toBeLessThan(0.0187);
    const residual = 1 / Math.sqrt(f) + 2 * Math.log10(1e-4 / 3.7 + 2.51 / (1e5 * Math.sqrt(f)));
    expect(Math.abs(residual)).toBeLessThan(1e-6);
    expect(colebrook(1000, 1e-4)).toBeCloseTo(0.064, 6); // laminar 64/Re
  });
  it("pierdere locală: K=2, v=1.5 → 2250 Pa", () => {
    expect(localLoss(2, 1000, 1.5)).toBeCloseTo(2250, 6);
  });
});

describe("selecția DN (v ≤ vMax și R ≤ Rmax)", () => {
  it("alege cel mai mic DN valid; treapta anterioară încalcă un criteriu", () => {
    const rMax = 150;
    const fp = fluidProps("water", 0, 10);
    for (const flow of [2, 10, 40, 150]) {
      const dn = selectDn("steel_carbon", flow, fp, rMax);
      const u = unitLoss("steel_carbon", dn, flow, fp);
      expect(u.v).toBeLessThanOrEqual(limitsFor(dn)[1]);
      expect(u.R).toBeLessThanOrEqual(rMax);
      const [lo] = getMaterial("steel_carbon").dnRange;
      const smaller = DN_LIST.filter((d) => d >= lo && d < dn);
      for (const d of smaller) {
        const s = unitLoss("steel_carbon", d, flow, fp);
        expect(s.v > limitsFor(d)[1] || s.R > rMax).toBe(true);
      }
    }
  });
});

describe("autoBends", () => {
  it("numără doar schimbările reale de direcție", () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, // coliniar
      { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 10 }, // duplicat
      { x: 30, y: 20 },
    ];
    expect(countDirectionChanges(pts)).toBe(3);
    expect(countDirectionChanges([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 }])).toBe(0);
  });
  it("pe un tronson cu puncte coliniare nu adaugă coturi false", () => {
    // tee.b (dreapta) → tee2.a (stânga), aceeași cotă y; puncte intermediare coliniare
    const s = scheme(
      [node("T1", "tee", 0, 0), node("T2", "tee", 400, 0)],
      [pipe("P", ["T1", "b"], ["T2", "a"], 10, 5, { points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }] })],
    );
    expect(autoBends(s.pipes[0]!, s)).toBe(0);
  });
});

describe("rețea ramificată", () => {
  const nodes = [
    node("CH", "chiller", 0, 0),
    node("T", "tee", 300, 0),
    node("A", "ccu", 600, 0, { flow: 10, dpFixed: 30 }),
    node("B", "ccu", 300, 300, { flow: 10, dpFixed: 30 }),
  ];
  const pipes = [
    pipe("P1", ["CH", "c"], ["T", "a"], 10, 20, { dn: 65 }),
    pipe("P2", ["T", "b"], ["A", "a"], 80, 10),
    pipe("P3", ["T", "c"], ["B", "a"], 5, 10),
  ];
  const s = scheme(nodes, pipes);

  it("Δp sistem = traseul critic, nu suma tuturor ramurilor", () => {
    const ev = evaluateNetwork(s, FP);
    const r = (id: string) => ev.pipes.get(id)!.dpTotal;
    const sumAll = r("P1") + r("P2") + r("P3");
    expect(ev.critical?.pipes).toEqual(["P1", "P2"]);
    expect(ev.critical?.endTag).toBe("A");
    expect(ev.systemDp).toBeCloseTo(r("P1") + r("P2"), 6);
    expect(ev.systemDp).toBeLessThan(sumAll);
    expect(ev.critical?.method).toBe("critical-path-evaluation");
    expect(ev.networkSolved).toBe(true);
    expect(ev.status).toBe("solved");
    // separare conductă / echipament
    const p2 = ev.pipes.get("P2")!;
    expect(p2.dpComp).toBeCloseTo(30000, 6);
    expect(p2.dpTotal).toBeCloseTo(p2.dpPipe + p2.dpComp, 6);
  });

  it("debitele deduse la teu respectă continuitatea", () => {
    const f = propagateFlows(s, FP);
    expect(f.get("P1")).toMatchObject({ flow: 20, ambiguous: false });
    expect(f.get("P2")).toMatchObject({ flow: 10, ambiguous: false });
    expect(f.get("P3")).toMatchObject({ flow: 10, ambiguous: false });
  });

  it("circuitTotals rămâne inventar (suma), separat de Δp sistem", () => {
    const ev = evaluateNetwork(s, FP);
    const c = ev.circuits.get("supply")!;
    expect(c.n).toBe(3);
    expect(c.dp).toBeGreaterThan(ev.systemDp);
  });
});

describe("statusuri", () => {
  it("Re tranzițional → warning", () => {
    const s = scheme([node("T1", "tee", 0, 0), node("T2", "tee", 0, 0)], [pipe("P", ["T1", "b"], ["T2", "a"], 1, 0.15, { dn: 20 })]);
    const r = computePipe(s.pipes[0]!, s, FP);
    expect(r.regime).toBe("tranziție");
    expect(r.warnings.map((w) => w.code)).toContain("transitional_re");
    expect(r.status).not.toBe("ok");
  });
  it("debit lipsă → incomplete", () => {
    const s = scheme([node("T1", "tee", 0, 0), node("T2", "tee", 0, 0)], [pipe("P", ["T1", "b"], ["T2", "a"], 1, 0)]);
    expect(computePipe(s.pipes[0]!, s, FP).status).toBe("incomplete");
  });
  it("elevația nu este adăugată în circuit închis", () => {
    const s = scheme([node("T1", "tee", 0, 0), node("U", "riser_up", 0, 0, { z: 10 })], [pipe("P", ["T1", "b"], ["U", "a"], 1, 5)]);
    const r = computePipe(s.pipes[0]!, s, FP);
    expect(r.dpStatic).toBe(0);
  });
});

describe("buclă / ramuri paralele", () => {
  it("propagarea marchează paralelele ambiguous; solverul de rețea le rezolvă (Sprint 2)", () => {
    const s = scheme(
      [node("CH", "chiller", 0, 0), node("T1", "tee", 200, 0), node("T2", "tee", 500, 0), node("A", "ccu", 800, 0, { flow: 10, dpFixed: 20 })],
      [
        pipe("S", ["CH", "c"], ["T1", "a"], 5, 10),
        pipe("L1", ["T1", "b"], ["T2", "a"], 20, 5),
        pipe("L2", ["T1", "c"], ["T2", "c"], 30, 5),
        pipe("E", ["T2", "b"], ["A", "a"], 5, 10),
      ],
    );
    const f = propagateFlows(s, FP);
    expect(f.get("L1")?.ambiguous).toBe(true);
    expect(f.get("L2")?.ambiguous).toBe(true);
    const ev = evaluateNetwork(s, FP);
    expect(ev.status).toBe("solved");
    expect(ev.solution.converged).toBe(true);
    // fără convergență (1 iterație, toleranță imposibilă) rămâne unresolved
    const bad = evaluateNetwork(s, FP, { maxIterations: 1, tolPa: 1e-12, tolFlow: 1e-12 });
    expect(bad.status).toBe("unresolved");
    expect(bad.warnings.some((w) => w.code === "flow_unresolved" || w.code === "not_converged")).toBe(true);
    expect(criticalPath(s, FP)?.method).toBe("critical-path-evaluation");
  });
});
