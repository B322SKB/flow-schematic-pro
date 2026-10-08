# Hydraulic engine — method and current limitations (Sprint 2)

## Method
- `src/lib/pid/solver.ts` — network solver, Hardy-Cross on fundamental loops.
  - Each circuit is solved separately (supply / return / glycol...), per connected component.
  - Initial flows come from a BFS spanning tree rooted at the active source: node continuity is exact from the start; chords start at Q = 0 (no 50/50 split assumption).
  - Loop correction: ΔQ = −Σ s·h(Q) / Σ h'(Q), h(Q) = sign(Q)·Δp(|Q|), Δp = Darcy-Weisbach (Colebrook, laminar 64/Re) + ΣK·ρv²/2 + equipment Δp (scaled as (Q/Qref)² when a reference flow exists).
  - Sign convention: Q > 0 follows the drawing direction (from → to). Return circuits are solved in supply convention and sign-flipped.
  - Convergence: max loop residual < `tolPa` (default 1 Pa) AND max |ΔQ| < `tolFlow` (default 1e-4 m³/h), within `maxIterations` (default 200). Otherwise `not_converged` → status `unresolved`, results not valid.
- System Δp = max over terminals of the converged pressure difference source → terminal, summed over circuits (supply + return). Never the sum of all branches.
- `circuitTotals` is an inventory only.

## Limitations (preliminary solver — not final design precision)
- No pump curves; `pumpDuty` is a preliminary duty estimate. Multiple sources in parallel share flow equally (flagged).
- Equipment Δp is attributed to the pipe ending at the equipment (drawing direction).
- Terminals are fixed-demand sinks (no balancing-valve / control-valve authority modelling).
- Catalogue data (inner diameters, roughness, K) is approximate.
- Glycol properties are engineering-estimate correlations (±3–8%).
- Closed circuits only: static head ρ·g·Δz is not applied (it cancels in closed loops). Open systems not yet supported.
