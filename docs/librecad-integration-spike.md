# LibreCAD integration spike — decision note

Date: 2026-10-24
Repository branch: `feature/pid-onprem-poc`
Status: source/documentation feasibility review; no Windows runtime test has yet been performed.

## Executive conclusion

Do not commit to LibreCAD 2.2 as the long-term P&ID desktop host without a hands-on prototype. Its plugin interface is documented by the project community as deliberately limited: plugins can inspect selected/all entities and add, modify or delete entities, but it is not a rich AutoCAD-like automation API. It may still work for a narrowly-scoped bridge, but the semantic edit workflow would likely require deeper C++ integration or a fork.

Add LibreCAD 3 to the PoC comparison. Its current source documents Lua and Python scripting, operation registration, GUI events, entity/storage APIs, undo integration, and custom-entity persistence in DXF. That is materially closer to the requirements for a semantic P&ID adapter. However, LibreCAD 3 is actively developed and its own documentation explicitly leaves Windows artifact/installer acceptance and full packaged lifecycle validation open. Therefore it is a promising technical candidate, not a production-ready decision.

**Recommendation:** run a time-boxed Windows spike comparing LibreCAD 2.2 and LibreCAD 3. Keep the desktop-host choice open until the acceptance tests below pass on the actual workstation image.

## Evidence reviewed

### LibreCAD 2.2
- The official repository identifies LibreCAD as a Qt-based 2D CAD application and documents GPLv2 licensing. Its current 2.2.2 line requires Qt 6.4+; 2.2.1 requires Qt 5.15+.
- The 2.2 documentation lists a plugin system as a feature.
- A LibreCAD maintainer response in the developer forum describes the v2 plugin interface as rudimentary and says its exposed interface is in `librecad/src/plugins`, particularly `document_interface.h` and `qc_plugininterface.h`. The described operations include requesting selected/all entities and iterating, deleting, modifying or adding entities.
- Official Windows source-build documentation exists, but a source build is not evidence of a stable packaged extension API or a supported Windows plugin lifecycle.

Implication: use v2 only if the exact needed actions can be implemented through its real plugin interface without invasive changes. Do not assume AutoCAD-style command reactors, arbitrary property sets or deep editor hooks.

### LibreCAD 3
The current project documentation describes:
- embedded Lua and Python scripting through a shared C++ scripting layer;
- operation registration and GUI event callbacks, including selection changes and mouse/command events;
- document/entity storage and representative undo/redo operations;
- DXF/DXB persistence APIs;
- script-defined custom entities with persistence hooks.

The documented custom-entity DXF mechanism writes LibreCAD app-data (group 102, application name `LibreCAD`, group 410 plugin name, group 411 entity name, and 470/471 parameter pairs). The documented regression tests create, save, reopen and reconstruct custom entities, including a Lua-write/Python-reopen path.

Important qualification: the same scripting document says custom-entity DXF round-trip tests pass on hosted Linux x64 and macOS arm64, while Windows acceptance remains open. It also says Windows installer acceptance remains open, and the Windows native test/installer work has unresolved dependency acceptance. This is a significant deployment risk for a Windows-only workstation fleet.

## Candidate comparison

| Requirement | LibreCAD 2.2 | LibreCAD 3 |
|---|---|---|
| Windows desktop target | Established application/build path; plugin deployment must be tested | Windows build exists in project work, but final installer/artifact acceptance is explicitly open |
| Extensibility | Plugin interface, limited/rudimentary | Lua + Python scripting, operation registration and events |
| Read/write document entities | Available through plugin interface | Exposed entity/storage/builder APIs with focused tests |
| Semantic custom entity | Not demonstrated in this review | Explicit custom-entity persistence hook |
| DXF custom metadata round-trip | Must be proven independently | Documented app-data mechanism and regression tests on Linux/macOS |
| Undo/redo integration | Must be proven for plugin changes | Representative scripting undo/redo tests documented |
| Production confidence for Windows | Higher baseline app maturity; integration API risk | Higher integration potential; packaging/runtime risk |

## Proposed Windows spike (2–3 engineering days, time-boxed)

### Environment
- A clean Windows 11 x64 VM matching the intended workstation baseline.
- Pin exact LibreCAD release/tag/commit and installer checksum.
- No dependency on a developer's globally installed Python or Qt.
- Record application version, architecture, Qt/runtime versions and plugin load diagnostics.

### Minimal adapter prototype
Implement the same four commands in both candidate hosts where possible:
1. `PID_CREATE_EQUIPMENT`: create one equipment block/symbol with a permanent semantic UUID and tag.
2. `PID_CREATE_PIPE`: create a line/polyline with pipe UUID and explicit from/to node UUID + port IDs.
3. `PID_MOVE_ENTITY`: move equipment while retaining UUID and all connected pipe endpoint references.
4. `PID_READ_SELECTION`: return selected entity UUID, semantic type, tag and geometry to a local bridge process.

### Persistence test
- Save drawing, close application completely, restart, reopen drawing.
- Read the same semantic UUIDs and connection references.
- Save through LibreCAD after a geometry-only move.
- Reopen and compare IDs, tags, endpoints, layers, coordinates and supported entity types.
- Test a normal DXF round trip through another DXF reader if available.
- Verify unknown/custom metadata is not silently stripped by the target save path.

### Bridge test
- Local adapter sends a JSON operation to a local test service (no production server yet).
- Service acknowledges operation ID and revision.
- Adapter applies an accepted operation and reports the resulting semantic UUID/geometry.
- Disconnect network, queue one operation locally, reconnect and replay with idempotency key.
- Reject stale base revision; never overwrite silently.

### Pass/fail gates
- 100% of pilot entities retain semantic UUIDs after save/reopen.
- 100% of pipe endpoints still reference existing nodes and valid ports after move/rotate.
- No duplicate custom entities after reopen.
- Failed/partial DXF import is surfaced, not treated as a successful round trip.
- Plugin/script can load from a clean installed package, not only a developer build.
- No dependency on ambient Python/Qt paths.
- Two-client conflict/replay test has deterministic outcomes.

## Data contract recommendation

Keep the authoritative P&ID semantic model in the central application service. In CAD, store:
- `pid_uuid`: permanent semantic object UUID;
- `pid_kind`: equipment / valve / instrument / pipe / annotation;
- `pid_tag`: human-readable tag;
- `pid_schema_version`: metadata contract version;
- for pipe objects: `from_node_uuid`, `from_port_id`, `to_node_uuid`, `to_port_id`.

Treat CAD handles and block references as disposable mappings. A geometry edit must not generate a new semantic UUID. Do not make raw CAD geometry the only source of topology.

For LibreCAD 3, prototype the documented custom-entity mechanism, but also evaluate a sidecar JSON mapping keyed by stable semantic UUID as a fallback/interchange strategy. The sidecar must include the DXF checksum and drawing revision; reject stale/mismatched pairs rather than silently applying metadata to the wrong drawing.

## Licensing and distribution

LibreCAD 2 is GPLv2; LibreCAD 3 repository licensing must be checked at the exact pinned commit and all bundled dependencies must be inventoried. Before distributing a modified executable, plugin bundle or fork internally/externally, obtain legal review of GPL obligations, notices, source-offer requirements and whether the proposed adapter is a separate work or a derivative work. This note is not a legal opinion.

## Decision

**Shortlist LibreCAD 3 for the first semantic-adapter prototype; keep LibreCAD 2.2 as a control candidate. Do not yet approve either as the production desktop CAD engine.** The deciding evidence is a clean Windows install, custom metadata round-trip, selection/edit event handling and stable identity through geometry changes.
