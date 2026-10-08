import { describe, expect, it } from "vitest";
import { innerDiameterMm } from "./catalog";
import { engineeringCheck } from "./checks";
import { fluidProps, type FluidProps } from "./fluids";
import { selectDn } from "./hydraulics";
import { planSizing, sizePipe, type SizingMode } from "./sizing";
import { solveNetwork } from "./solver";
import type { PidNode, Pipe, Scheme } from "./types";

const FP: FluidProps = fluidProps("water", 0, 10);
const node = (id: string, type: string, x: number, y: number, extra: Partial<PidNode> = {}): PidNode =>
  ({ id, type, tag: id, x, y, rotation: 0, ...extra });
const pipe = (id: string, from: [string, string], to: [string, string], length: number, flow = 0, extra: Partial<Pipe> = {}): Pipe => ({
  id, tag: id, from: { node: from[0], port: from[1] }, to: { node: to[0], port: to[1] },
  dn: 50, material: "steel_carbon", joint: "welded", circuit: "supply", length, flow,
  flowMode: "manual", routing: "auto", fittings: {}, ...extra,
});
const scheme = (nodes: PidNode[], pipes: Pipe[], extra: Partial<Scheme> = {}): Scheme => ({
  id: "t", name: "t", nodes, pipes, fluid: "water", concentration: 0, temperature: 10, deltaT: 5,
  circuitColors: {}, customSymbols: [], revision: "A", updatedAt: 0, ...extra,
});
const radial = (flow: number, extra: Partial<Scheme> = {}, dn = 50) => scheme(
  [node("CH", "chiller", 0, 0, { dpFixed: 40 }), node("A", "ccu", 600, 0, { flow, dpFixed: 20 })],
  [pipe("P", ["CH", "c"], ["A", "a"], 20, flow, { dn })], extra,
);

const MODES: SizingMode[] = ["legacy", "velocity", "gradient", "balanced"];

describe("Sizing – moduri", () => {
  for (const mode of MODES) {
    it(`${mode}: recomandă cel mai mic DN acceptat; treptele mai mici sunt respinse`, () => {
      const s = radial(25);
      const sz = sizePipe(s.pipes[0]!, 25, FP, s, { mode });
      expect(sz.status).toBe("ok");
      const sel = sz.candidates.find((c) => c.status === "selected")!;
      expect(sel.dn).toBe(sz.recommended);
      expect(sel.reasons).toEqual([]);
      for (const c of sz.candidates.filter((c) => c.dn < sel.dn)) expect(c.reasons.length).toBeGreaterThan(0);
      if (mode === "velocity") for (const c of sz.candidates) expect(c.reasons).not.toContain("gradient_high");
      if (mode === "gradient") for (const c of sz.candidates) expect(c.reasons).not.toContain("velocity_high");
    });
  }

  it("legacy = criteriile existente (selectDn neschimbat)", () => {
    for (const q of [2, 10, 40, 150]) {
      const s = radial(q);
      expect(sizePipe(s.pipes[0]!, q, FP, s, { mode: "legacy" }).recommended).toBe(selectDn("steel_carbon", q, FP, 150, s));
    }
  });

  it("balanced: nu e mai mare decât legacy și nu e supradimensionat", () => {
    for (const q of [3, 12, 60]) {
      const s = radial(q);
      const b = sizePipe(s.pipes[0]!, q, FP, s, { mode: "balanced" });
      const l = sizePipe(s.pipes[0]!, q, FP, s, { mode: "legacy" });
      expect(b.recommended).toBeLessThanOrEqual(l.recommended);
      const sel = b.candidates.find((c) => c.status === "selected")!;
      expect(Math.max(sel.v / sel.vMax, sel.R / sel.rMax)).toBeGreaterThanOrEqual(0.35);
    }
  });

  it("DN limitat de viteză (Rmax foarte mare)", () => {
    const s = radial(25);
    const sz = sizePipe(s.pipes[0]!, 25, FP, s, { mode: "legacy", rMax: 1e9 });
    const below = sz.candidates.filter((c) => c.dn < sz.recommended);
    expect(below.length).toBeGreaterThan(0);
    for (const c of below) expect(c.reasons).toEqual(["velocity_high"]);
  });

  it("DN limitat de Pa/m (vMax foarte mare)", () => {
    const vl: Record<number, [number, number]> = {};
    for (const d of [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400]) vl[d] = [0, 100];
    const s = radial(25, { velocityLimits: vl });
    const sz = sizePipe(s.pipes[0]!, 25, FP, s, { mode: "legacy", rMax: 100 });
    const below = sz.candidates.filter((c) => c.dn < sz.recommended);
    expect(below.length).toBeGreaterThan(0);
    for (const c of below) expect(c.reasons).toEqual(["gradient_high"]);
    expect(sz.candidates.find((c) => c.status === "selected")!.R).toBeLessThanOrEqual(100);
  });

  it("candidat respins pentru fiecare criteriu", () => {
    const s = radial(25);
    const all = new Set<string>();
    for (const c of sizePipe(s.pipes[0]!, 25, FP, s, { mode: "legacy" }).candidates) c.reasons.forEach((r) => all.add(r));
    for (const c of sizePipe(s.pipes[0]!, 25, FP, s, { mode: "balanced", minUtilisation: 0.5 }).candidates) c.reasons.forEach((r) => all.add(r));
    expect(all).toContain("velocity_high");
    expect(all).toContain("gradient_high");
    expect(all).toContain("oversized");
  });
});

describe("Re-rezolvarea rețelei după resize", () => {
  it("radial: soluția folosește DN-ul nou", () => {
    const s = radial(25, {}, 15);
    const plan = planSizing(s, FP, { mode: "legacy" });
    const dn = plan.changes.get("P")!;
    expect(dn).toBeGreaterThan(15);
    expect(plan.solution.pipes.get("P")!.d).toBeCloseTo(innerDiameterMm("steel_carbon", dn) / 1000, 9);
    expect(plan.solution.networkSolved).toBe(true);
    expect(s.pipes[0]!.dn).toBe(15); // schema originală nemodificată (Undo posibil)
  });

  it("buclă: redistribuirea debitelor după redimensionare", () => {
    const s = scheme(
      [node("CH", "chiller", 0, 0), node("T1", "tee", 200, 0), node("T2", "tee", 500, 0), node("A", "ccu", 800, 0, { flow: 20, dpFixed: 20 })],
      [
        pipe("S", ["CH", "c"], ["T1", "a"], 5, 0, { dn: 80 }),
        pipe("L1", ["T1", "b"], ["T2", "a"], 30, 0, { dn: 15 }),
        pipe("L2", ["T1", "c"], ["T2", "c"], 30, 0, { dn: 65 }),
        pipe("E", ["T2", "b"], ["A", "a"], 5, 0, { dn: 80 }),
      ],
    );
    const before = solveNetwork(s, FP);
    const plan = planSizing(s, FP, { mode: "legacy" });
    expect(plan.changes.has("L1")).toBe(true);
    expect(plan.solution.converged).toBe(true);
    const q1b = Math.abs(before.pipes.get("L1")!.flowSigned);
    const q1a = Math.abs(plan.solution.pipes.get("L1")!.flowSigned);
    expect(q1a).not.toBeCloseTo(q1b, 2);
    expect(Math.abs(plan.solution.pipes.get("L1")!.flowSigned) + Math.abs(plan.solution.pipes.get("L2")!.flowSigned)).toBeCloseTo(20, 3);
    // stabil: o nouă trecere nu mai schimbă nimic
    expect(planSizing(plan.scheme, FP, { mode: "legacy" }).changes.size).toBe(0);
  });
});

describe("Engineering Check", () => {
  it("date lipsă și echipament fără Δp → incomplete", () => {
    const s = scheme([node("CH", "chiller", 0, 0, { dpFixed: 40 }), node("A", "ccu", 600, 0, { flow: 5 })], [pipe("P", ["CH", "c"], ["A", "a"], 10, 5, { dn: 0 })]);
    const r = engineeringCheck(s, FP);
    const p = r.elements.find((e) => e.id === "P")!;
    expect(p.items.some((i) => i.metric === "data" && i.level === "incomplete")).toBe(true);
    const a = r.elements.find((e) => e.id === "A")!;
    expect(a.items.find((i) => i.metric === "equipment_dp")!.level).toBe("incomplete");
    expect(["incomplete", "unresolved"]).toContain(r.status);
  });

  it("limite depășite → warning cu abatere, probleme prioritizate", () => {
    const s = radial(25, {}, 25);
    const r = engineeringCheck(s, FP);
    const p = r.elements.find((e) => e.id === "P")!;
    const v = p.items.find((i) => i.metric === "velocity")!;
    const g = p.items.find((i) => i.metric === "gradient")!;
    expect(v.level).toBe("warning");
    expect(v.deviation!).toBeGreaterThan(0);
    expect(g.level).toBe("warning");
    expect(r.status).toBe("warning");
    expect(r.issues[0]!.deviation).toBeGreaterThanOrEqual(r.issues[r.issues.length - 1]!.deviation);
  });

  it("proiect corect → OK", () => {
    const s = radial(5);
    const plan = planSizing(s, FP, { mode: "legacy" });
    expect(engineeringCheck(plan.scheme, FP).status).toBe("ok");
  });
});
