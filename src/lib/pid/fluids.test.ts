import { describe, expect, it } from "vitest";
import { fluidProps } from "./fluids";

describe("Fluid properties", () => {
  it("water at 20 °C from reference table", () => {
    const f = fluidProps("water", 0, 20);
    expect(f.rho).toBeCloseTo(998.21, 2);
    expect(f.mu).toBeCloseTo(1.002e-3, 6);
    expect(f.k).toBeCloseTo(0.598, 3);
    expect(f.dataSource).toBe("reference");
  });
  it("interpolates between table rows", () => {
    expect(fluidProps("water", 0, 35).rho).toBeCloseTo((995.65 + 992.22) / 2, 2);
  });
  it("out-of-range temperature flagged", () => {
    expect(fluidProps("water", 0, 120).rangeWarnings!.length).toBeGreaterThan(0);
  });
  it("EG / PG marked engineering-estimate, heavier and more viscous than water", () => {
    const w = fluidProps("water", 0, 10);
    for (const g of ["eg", "pg"] as const) {
      const f = fluidProps(g, 30, 10);
      expect(f.dataSource).toBe("engineering-estimate");
      expect(f.rho).toBeGreaterThan(w.rho);
      expect(f.mu).toBeGreaterThan(w.mu);
      expect(f.k!).toBeLessThan(w.k!);
    }
  });
  it("unsupported concentration flagged", () => {
    expect(fluidProps("eg", 80, 10).rangeWarnings!.some((s) => s.includes("nesuportată"))).toBe(true);
  });
});
