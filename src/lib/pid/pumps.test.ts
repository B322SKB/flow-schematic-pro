import { describe, expect, it } from "vitest";
import { interpolateHead, operatingPoint, systemCurve, type PumpData } from "./pumps";

const base: PumpData = {
  tag: "P1", count: 1, arrangement: "single", mounting: "external", quality: "user-defined",
  curve: [{ q: 0, h: 30 }, { q: 20, h: 25 }, { q: 40, h: 15 }, { q: 50, h: 5 }],
  efficiency: [{ q: 0, eta: 0.3 }, { q: 30, eta: 0.75 }, { q: 50, eta: 0.6 }], motorEfficiency: 0.9, motorPower: 3,
};

describe("Pump engineering", () => {
  it("interpolates H(Q), no extrapolation", () => {
    expect(interpolateHead(base.curve, 30)).toBeCloseTo(20);
    expect(interpolateHead(base.curve, 60)).toBeNaN();
  });
  it("single pump operating point on system curve", () => {
    const r = operatingPoint(base, systemCurve(30, 20));
    expect(r.q).toBeCloseTo(30, 2);
    expect(r.h).toBeCloseTo(20, 2);
    expect(r.hydraulicKw).toBeCloseTo((30 / 3600) * 1000 * 9.81 * 20 / 1000, 3);
    expect(r.shaftKw!).toBeCloseTo(r.hydraulicKw / 0.75, 3);
    expect(r.status).toEqual(["ok"]);
  });
  it("parallel pumps sum flow at equal head", () => {
    const r = operatingPoint({ ...base, count: 2, arrangement: "parallel" }, systemCurve(60, 20));
    expect(r.q).toBeCloseTo(60, 1);
    expect(r.qPerPump).toBeCloseTo(30, 1);
  });
  it("series pumps sum head", () => {
    const r = operatingPoint({ ...base, count: 2, arrangement: "series" }, systemCurve(30, 40));
    expect(r.h).toBeCloseTo(40, 1);
  });
  it("insufficient head and outside curve", () => {
    expect(operatingPoint(base, { h0: 35, k: 0 }).status).toContain("insufficient_head");
    expect(operatingPoint(base, { h0: 0, k: 0.0001 }).status).toContain("outside_curve");
  });
  it("missing efficiency and motor sizing", () => {
    expect(operatingPoint({ ...base, efficiency: undefined }, systemCurve(30, 20)).status).toContain("efficiency_missing");
    expect(operatingPoint({ ...base, motorPower: 1 }, systemCurve(30, 20)).status).toContain("motor_undersized");
    expect(operatingPoint({ ...base, curve: [] }, systemCurve(30, 20)).basis).toBe("unavailable");
  });
});
