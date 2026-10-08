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

## Productivity / CAD layer (local-first)
- All schema mutations go through `patchScheme` in `store.ts`, which records a transaction (`history.ts`): the same record feeds Undo/Redo, the Change Summary and the session log. Batch operations use `transact()` / `beginTx()`–`endTx()` (drag, bulk edit, paste, copilot apply).
- Undo/Redo history and the change log live in memory per active scheme (max 100 transactions / 200 log entries) and are **not** persisted across page reloads; the scheme itself is persisted and migrated (`migrate.ts`, schemaVersion 3).
- Typing into the same field within 1 s, and arrow-key nudges, coalesce into one transaction.
- Smart routing is a heuristic orthogonal candidate search (H/V, V/H, H/V/H, V/H/V with offsets) scored by length, bends, equipment hits and crossings; it is applied only on explicit command and is undoable. It is not a full maze router.
- Copilot is a deterministic local provider; it only produces proposals and every change requires Preview → Apply (one undo step). No external AI is connected.
- Layer lock prevents move/edit/delete through store actions; hidden layers are excluded from rendering and box selection. Insulation is stored per pipe but not yet aggregated in the MTO.
