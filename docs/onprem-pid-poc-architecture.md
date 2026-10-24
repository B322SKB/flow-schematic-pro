# On-prem P&ID PoC — architecture and repository audit

Status: initial technical audit, branch `feature/pid-onprem-poc`.
Baseline: existing browser application; this document records findings and the proposed proof-of-concept boundary. It does not claim that the on-prem architecture is already implemented.

## 1. Executive decision

Extend the existing P&ID application rather than rewrite it. Keep the current engineering model and calculation modules as the domain core. Introduce a server-authoritative project/revision layer and a synchronization boundary around the model. Treat CAD geometry and DXF as representations/interchange, not as the canonical engineering database.

The first PoC must prove the hardest integration risks before a large feature build:
1. stable semantic identity survives browser/desktop round trips;
2. two clients can edit without silent lost updates;
3. topology and pipe-port relationships survive geometry changes;
4. DXF import/export has a measured, documented loss profile;
5. a calculation result is tied to an immutable model revision and input assumptions.

## 2. Current repository findings

### Existing capabilities worth preserving
- React 19 + TypeScript + TanStack Start/Vite application.
- Zustand store with schema mutations routed through `patchScheme`, transaction history, Undo/Redo, batch operations and change summaries.
- P&ID model already separates nodes and pipes. Nodes have IDs and coordinates; pipes reference node IDs and ports, and store DN, material, joint, circuit, flow, length, fittings and route geometry.
- Domain modules are separated from UI: symbols, catalog, fluids, hydraulics, solver, pumps, sizing, BOM, checks, export, migration, routing and connection validation.
- Hydraulic solver implements Hardy-Cross over fundamental loops; tests cover radial, branched, parallel-path and loop cases, including non-equal flow split for different resistances.
- Exports currently include DXF, PDF, PNG and SVG.
- Existing tests use Vitest and include solver and productivity suites.

### Constraints that block an on-prem multi-user deployment
- The current store uses Zustand `persist` in the browser; the project is saved locally in the browser, not in a central database.
- Undo/Redo and session change log are in-memory and are not persisted across reloads.
- There is no observed server API, authentication/authorization layer, PostgreSQL schema, WebSocket collaboration service or central revision store in the current application.
- The current ID helper in `store.ts` uses a short random base-36 string. That is not a suitable collision-resistant permanent identifier for a multi-user system. The migration layer also generates short IDs when an imported scheme has no ID.
- The hydraulic solver currently warns and applies an equal-split fallback when multiple active sources exist in the same circuit. This must remain explicitly preliminary until pump/system interaction is modelled and validated. The documentation and source comments must stay aligned.
- The solver's closed-circuit assumptions, approximate glycol correlations, terminal demand assumptions and equipment pressure-drop attribution must be visible in calculation reports; do not market the solver as universally design-certified.
- DXF export exists, but a round-trip fidelity test and a CAD-side semantic identity adapter are not yet demonstrated.

## 3. Proposed target architecture

### Components
- **Browser application:** reuse the current React/TypeScript editor, viewer, project navigation, property editing, calculations and reports.
- **Application API:** REST endpoints for projects, drawings, entities, revisions, catalogs, calculation runs and exports.
- **Collaboration channel:** WebSocket events for accepted operations, presence and revision notifications. PostgreSQL remains the source of truth; WebSocket/Redis must not become the durable store.
- **Database:** PostgreSQL for users, projects, drawings, semantic P&ID entities, connections, revisions, operation log, calculation snapshots and audit events.
- **Desktop CAD adapter:** a Windows client/bridge for the selected CAD engine. It synchronizes semantic operations and maps CAD objects to permanent P&ID UUIDs. The desktop editor must not overwrite a shared DXF as a substitute for collaboration.
- **File storage:** central NAS/object/file storage for drawing exports, attachments and revision packages; database stores metadata and checksums.

### Semantic identity
Use UUIDs for persistent projects, drawings, nodes, pipes, ports, catalog items, revisions and operations. Keep CAD handle/object IDs as separate, replaceable identifiers mapped to semantic UUIDs. Do not use DXF handles as the P&ID identity.

A pipe connection must remain an explicit relation to node UUID + port ID. Screen coordinates, nearest-point snapping and DXF geometry alone must never define engineering connectivity.

### Suggested core entities
- `projects`, `drawings`
- `pid_entities` (equipment, valves, instruments, nodes)
- `pid_ports`, `pid_connections` (pipe endpoints and port relations)
- `cad_entities` (semantic UUID ↔ CAD object/handle mapping)
- `symbol_definitions`, `catalog_items`
- `drawing_revisions`, `drawing_operations`, `audit_events`
- `calculation_runs`, `calculation_results`, `bom_items`

The exact normalized schema should follow the existing TypeScript domain model and be validated with real pilot drawings before being frozen.

## 4. Collaboration and consistency model

Use server-accepted semantic operations, not file-level last-write-wins:
- MOVE_ENTITY
- UPDATE_ENTITY_PROPERTIES
- UPDATE_PIPE_PROPERTIES
- CONNECT_PORTS / DISCONNECT_PORTS
- CREATE_ENTITY / DELETE_ENTITY
- UPDATE_DRAWING_SETTINGS

Each operation carries operation UUID, project/drawing UUID, actor, base revision, target UUIDs, payload and timestamp. The server validates permissions, current revision, entity existence, port compatibility and domain rules; then persists the operation and resulting revision before broadcasting it.

For the PoC, use optimistic concurrency with explicit conflict responses. A stale operation must be rejected or surfaced for resolution; it must never silently overwrite a newer revision. Presence/selection locks are advisory. Structural operations can use short-lived entity/port locks if testing demonstrates the need.

Calculations must run against an immutable revision snapshot. Store solver version, fluid properties, assumptions, warnings and results with the calculation run so later edits cannot silently change historical results.

## 5. CAD engine decision gate

LibreCAD is a candidate, not yet a proven selection. Before committing to a deep fork/plugin strategy, run a technical spike on the target Windows version:
- determine whether the needed integration can be implemented as a plugin, external bridge, command extension or requires a fork;
- prove access to create/open/save, object identity, selection, move, delete, snapping and DXF serialization;
- test whether a semantic UUID can be preserved in DXF using supported metadata/custom entities or a sidecar mapping;
- document GPLv2 obligations and obtain legal review before distributing a modified/forked desktop client.

Do not build the full symbol library until the bridge feasibility is proven.

## 6. PoC scope and acceptance tests

### Pilot drawing
One chiller, two pumps (duty/standby), buffer tank, expansion vessel, 8–10 valves, supply/return piping and representative temperature, pressure and flow instruments.

### PoC sequence
1. Create a project and drawing in the browser.
2. Persist the semantic model centrally and reopen it in a second browser session.
3. Open the same drawing in the desktop CAD client.
4. Move an equipment item in desktop; verify its UUID and all connected pipe endpoints remain unchanged.
5. Change a valve property in browser; verify the desktop client receives the accepted revision.
6. Make conflicting edits from two clients; verify conflict detection and no silent lost update.
7. Export DXF, reopen/import it, and compare semantic objects, coordinates, tags, ports and connectivity against the source revision.
8. Run topology validation and a hydraulic calculation; verify result references the exact source revision and records assumptions/warnings.
9. Generate BOM/MTO from that same revision.

### Exit criteria
- No semantic ID changes on geometry-only edits.
- No orphaned pipe endpoints after move/rotate/edit operations.
- All accepted operations are durable and ordered by revision.
- Conflicts are visible and cannot silently overwrite accepted changes.
- DXF round-trip losses are quantified; critical semantic properties are preserved either in DXF or in a verified sidecar mapping.
- Calculation and BOM outputs are revision-traceable.
- Repeatable automated tests cover operation validation, concurrency conflicts, identity mapping and import/export.

## 7. Recommended implementation phases

A. **Foundation spike:** API skeleton, PostgreSQL schema draft, UUID mapping, revision/operation contract, LibreCAD feasibility experiment.

B. **Two-client collaboration:** browser clients first; server-authoritative operations, optimistic concurrency, audit and reconnect/replay.

C. **Desktop bridge:** Windows packaging, CAD integration, semantic identity mapping, DXF round-trip tests.

D. **Engineering integration:** snapshot-based solver, calculation reports, BOM/MTO, permissions and audit.

Do not begin with Redis, distributed locks, elaborate microservices or a large CAD symbol catalog. Add those only when the measured PoC requires them.

## 8. Open technical questions

- Which exact Windows version(s) and LibreCAD release will be used on engineering workstations?
- Must the desktop client be LibreCAD specifically, or can the PoC compare another CAD host if plugin access proves insufficient?
- Is Active Directory/LDAP mandatory for the first pilot, or can the PoC use local test accounts?
- How many simultaneous editors must the pilot support? Start by proving 2 concurrent editors; then load-test 5, 10 and higher.
- Which company P&ID symbol/tagging conventions and ISO/ISA profile are authoritative?

## 9. Current status and limits of this audit

This is a source-level repository audit and architecture proposal. Tests have not been executed in a local runtime as part of this audit. The PoC infrastructure described above is not yet implemented. The next coding increment should be the smallest testable foundation slice, after the CAD integration gate and API/database choices are agreed.
