# P&ID API snapshot contract

Status: initial transport contract only. This does not add an API server or persistence.

A drawing currently maps one-to-one to the existing `Scheme` domain type in
`src/lib/pid/types.ts`. The API DTO in `src/lib/pid/api-dto.ts` wraps that
object as `{ formatVersion: 1, scheme }`. Its version is independent of
`Scheme.schemaVersion`, which is the browser-store migration version.

The snapshot deliberately retains the full Scheme rather than prematurely
normalizing it into database columns. It therefore carries:

- Nodes as `PidNode[]`, with stable IDs, symbol type, tag, coordinates,
  rotation, optional equipment properties, layer and pump data.
- Pipes as `Pipe[]`, including endpoint references as node ID plus port ID,
  DN/material/joint/circuit, flow and length, fittings, routing points,
  disabled/direct flags and optional layer/insulation.
- Drawing settings and model state: fluid assumptions, circuit colors, custom
  symbols, guides, velocity limits, revision, timestamps, schema version and
  layer state.

`parseSchemeSnapshotDto` checks the envelope version and the required outer
Scheme shape. It is not a substitute for domain-level engineering validation.
Future API endpoints should reject unsupported envelope versions and preserve
the drawing snapshot as a revisioned unit. PostgreSQL, server-side validation,
authentication and browser synchronization remain unimplemented.
