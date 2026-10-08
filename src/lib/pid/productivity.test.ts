import { beforeEach, describe, expect, it } from "vitest";
import { usePid } from "./store";
import { pipeRoute, portPos } from "./hydraulics";
import { matchShortcut, isEditableTarget } from "./shortcuts";
import { runCommand, type CommandCtx } from "./commands";
import { searchObjects } from "./search";
import { duplicateTags } from "./tags";
import { engineeringCheck } from "./checks";
import { fluidProps } from "./fluids";
import { solveNetwork } from "./solver";
import { diffSchemes, sessionSummary, HISTORY_LIMIT } from "./history";
import { migrateScheme, SCHEMA_VERSION } from "./migrate";
import { commonValue, MIXED } from "./bulk";
import { findSnapPort, validateConnection } from "./connect";
import { nodeVisible } from "./layers";
import { BUILTIN_MODULES } from "./modules";
import { getSymbol } from "./symbols";
import { localProvider, applyProposal } from "./copilot";
import { routeScore, smartRoute } from "./routing";
import type { Scheme } from "./types";

const S = () => usePid.getState();
const ctx: CommandCtx = { get: S, notify: () => {} };

/** Proiect gol + chiller, CCU și o conductă tur (chiller.c → ccu.a). */
function setup() {
  S().newProject("Test", "empty");
  S().addNode("chiller", 100, 200);
  const ch = S().scheme.nodes[0]!;
  S().addNode("ccu", 600, 200);
  const cc = S().scheme.nodes[1]!;
  S().updateNode(ch.id, { dpFixed: 40 });
  S().updateNode(cc.id, { flow: 10, dpFixed: 30 });
  S().connectPorts({ node: ch.id, port: "c" }, { node: cc.id, port: "a" });
  return { ch: S().scheme.nodes.find((n) => n.id === ch.id)!, cc: S().scheme.nodes.find((n) => n.id === cc.id)!, pipe: S().scheme.pipes[0]! };
}

beforeEach(() => {
  S().newProject("Test", "empty");
  S().setVisualMode("design");
});

describe("Undo / Redo tranzacțional", () => {
  it("undo/redo pe acțiuni și golirea redo la modificare nouă", () => {
    S().addNode("v_ball", 0, 0);
    S().addNode("v_gate", 100, 0);
    expect(S().scheme.nodes).toHaveLength(2);
    expect(S().undo()).toBe(true);
    expect(S().scheme.nodes).toHaveLength(1);
    expect(S().history.future).toHaveLength(1);
    expect(S().redo()).toBe(true);
    expect(S().scheme.nodes).toHaveLength(2);
    S().undo();
    S().addNode("strainer", 200, 0);
    expect(S().history.future).toHaveLength(0);
    expect(S().redo()).toBe(false);
  });

  it("istoric limitat", () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) S().addNode("v_ball", i * 10, 0);
    expect(S().history.past.length).toBe(HISTORY_LIMIT);
  });

  it("operație batch (transact) = un singur pas de undo", () => {
    const before = S().history.past.length;
    S().transact("Batch", () => { S().addNode("v_ball", 0, 0); S().addNode("v_ball", 50, 0); S().addNode("v_ball", 100, 0); });
    expect(S().history.past.length).toBe(before + 1);
    S().undo();
    expect(S().scheme.nodes).toHaveLength(0);
  });

  it("tastarea repetată într-un câmp se contopește într-o tranzacție", () => {
    S().addNode("ccu", 0, 0);
    const id = S().scheme.nodes[0]!.id;
    const n0 = S().history.past.length;
    S().updateNode(id, { kw: 1 }); S().updateNode(id, { kw: 12 }); S().updateNode(id, { kw: 120 });
    expect(S().history.past.length).toBe(n0 + 1);
    S().undo();
    expect(S().scheme.nodes[0]!.kw).toBeUndefined();
  });

  it("drag (beginTx/endTx) = un singur undo", () => {
    const { ch } = setup();
    const n0 = S().history.past.length;
    S().beginTx("Mutare CH");
    for (let i = 1; i <= 10; i++) S().updateNode(ch.id, { x: ch.x + i * 5 });
    S().endTx();
    expect(S().history.past.length).toBe(n0 + 1);
    S().undo();
    expect(S().scheme.nodes.find((n) => n.id === ch.id)!.x).toBe(ch.x);
  });
});

describe("Multi-select + bulk edit", () => {
  it("toggle cu Ctrl/Shift și select all", () => {
    const { ch, cc, pipe } = setup();
    S().select(null);
    S().toggleSelect("node", ch.id);
    S().toggleSelect("node", cc.id);
    S().toggleSelect("pipe", pipe.id);
    expect(S().multi).toEqual([ch.id, cc.id]);
    expect(S().multiPipes).toEqual([pipe.id]);
    S().toggleSelect("node", ch.id);
    expect(S().multi).toEqual([cc.id]);
    S().selectAll("pipes");
    expect(S().multiPipes).toHaveLength(1);
    expect(S().multi).toHaveLength(0);
  });

  it("valori mixed, ajustare compatibilă și un singur undo", () => {
    setup();
    const { ch } = { ch: S().scheme.nodes[0]! };
    S().addPipeToEnd({ node: ch.id, port: "a" }, 0, 0);
    S().selectAll("pipes");
    const ids = S().multiPipes;
    S().bulkPipes({ dn: 25 }, [ids[1]!]);
    expect(commonValue(S().scheme.pipes, "dn")).toBe(MIXED);
    const n0 = S().history.past.length;
    const r = S().bulkPipes({ material: "cf40" }); // cf40 DN 80–400 → DN ajustat, îmbinare fusion
    expect(r.changed).toHaveLength(2);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(S().scheme.pipes.every((p) => p.material === "cf40" && p.dn >= 80 && p.joint === "fusion")).toBe(true);
    expect(S().history.past.length).toBe(n0 + 1);
    // câmp incompatibil explicit → sărit cu motiv, nu forțat
    const r2 = S().bulkPipes({ joint: "threaded" });
    expect(r2.changed).toHaveLength(0);
    expect(r2.skipped[0]!.reason).toMatch(/nu este permisă/);
    S().undo();
    expect(S().scheme.pipes.some((p) => p.material === "steel_carbon")).toBe(true);
  });

  it("Activ/Redundant pe vane este sărit cu avertizare", () => {
    S().addNode("v_ball", 0, 0);
    S().addNode("ccu", 100, 0);
    const r = S().bulkNodes({ redundant: true }, S().scheme.nodes.map((n) => n.id));
    expect(r.changed).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });
});

describe("Copy / Paste smart", () => {
  it("păstrează topologia internă, ID-uri și tag-uri noi, offset consecutiv", () => {
    const { ch, cc } = setup();
    S().setSelection([ch.id, cc.id], []);
    S().copySelection();
    S().pasteClipboard();
    S().pasteClipboard();
    const s = S().scheme;
    expect(s.nodes).toHaveLength(6);
    expect(s.pipes).toHaveLength(3);
    expect(new Set(s.nodes.map((n) => n.id)).size).toBe(6);
    expect(duplicateTags(s).size).toBe(0);
    const pasted = s.pipes[2]!;
    const a = s.nodes.find((n) => n.id === pasted.from.node)!, b = s.nodes.find((n) => n.id === pasted.to.node)!;
    expect(a.type).toBe("chiller");
    expect(b.type).toBe("ccu");
    expect(a.x - ch.x).toBe(80); // al doilea paste: offset 2 × 40
    // paste multiplu = un undo per paste
    S().undo();
    expect(S().scheme.nodes).toHaveLength(4);
  });

  it("o singură conductă copiată devine conductă cu capete libere", () => {
    const { pipe } = setup();
    S().setSelection([], [pipe.id]);
    S().copySelection();
    S().pasteClipboard();
    const s = S().scheme;
    expect(s.pipes).toHaveLength(2);
    const np = s.pipes[1]!;
    expect(s.nodes.find((n) => n.id === np.from.node)!.type).toBe("port_open");
    expect(s.nodes.find((n) => n.id === np.to.node)!.type).toBe("port_open");
    expect(np.dn).toBe(pipe.dn);
  });
});

describe("Mutare și Smart Connect", () => {
  it("mutarea echipamentului păstrează conexiunile (geometrie actualizată)", () => {
    const { cc, pipe } = setup();
    S().moveNodes([cc.id], 100, 60);
    const s = S().scheme;
    const p = s.pipes.find((x) => x.id === pipe.id)!;
    expect(p.to.node).toBe(cc.id);
    const route = pipeRoute(p, s);
    const port = portPos(s, cc.id, "a")!;
    expect(route[route.length - 1]).toEqual(port);
  });

  it("validarea conexiunilor invalide", () => {
    const { ch, cc } = setup();
    const s = S().scheme;
    expect(validateConnection(s, { node: ch.id, port: "a" }, { node: ch.id, port: "b" }).ok).toBe(false);
    expect(validateConnection(s, { node: ch.id, port: "c" }, { node: cc.id, port: "c" }).reason).toBe("Port deja ocupat");
    expect(validateConnection(s, { node: ch.id, port: "a" }, { node: cc.id, port: "b" }).reason).toMatch(/TUR/);
    const ok = validateConnection(s, { node: ch.id, port: "b" }, { node: cc.id, port: "b" });
    expect(ok).toMatchObject({ ok: true, circuit: "return" });
    expect(S().connectPorts({ node: ch.id, port: "a" }, { node: ch.id, port: "b" }).ok).toBe(false);
  });

  it("Smart Connect din capătul liber al unei conducte", () => {
    const { ch, cc } = setup();
    S().addPipeToEnd({ node: ch.id, port: "d" }, 300, 400);
    const open = S().scheme.nodes.find((n) => n.type === "port_open")!;
    const target = portPos(S().scheme, cc.id, "b")!;
    const snap = findSnapPort(S().scheme, { x: target.x + 3, y: target.y - 2 }, 14, { node: open.id });
    expect(snap).toMatchObject({ node: cc.id, port: "b" });
    const r = S().smartConnectOpenEnd(open.id, { node: cc.id, port: "b" });
    expect(r.ok).toBe(true);
    const s = S().scheme;
    expect(s.nodes.some((n) => n.type === "port_open")).toBe(false);
    expect(s.pipes.some((p) => (p.from.node === ch.id && p.to.node === cc.id && p.to.port === "b") || (p.to.node === ch.id && p.from.node === cc.id))).toBe(true);
  });
});

describe("Scurtături", () => {
  it("mapare corectă și fără interferență cu câmpurile editabile", () => {
    expect(matchShortcut({ key: "z", ctrlKey: true })).toBe("undo");
    expect(matchShortcut({ key: "Z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(matchShortcut({ key: "y", ctrlKey: true })).toBe("redo");
    expect(matchShortcut({ key: "c", metaKey: true })).toBe("copy");
    expect(matchShortcut({ key: "a", ctrlKey: true })).toBe("select-all");
    expect(matchShortcut({ key: "f", ctrlKey: true })).toBe("find");
    expect(matchShortcut({ key: "k", ctrlKey: true })).toBe("command-bar");
    expect(matchShortcut({ key: "Delete" })).toBe("delete");
    expect(matchShortcut({ key: "Escape" })).toBe("cancel");
    expect(matchShortcut({ key: " " })).toBe("repeat");
    expect(matchShortcut({ key: "Home" })).toBe("zoom-fit");
    expect(matchShortcut({ key: "F8" })).toBe("toggle-ortho");
    expect(matchShortcut({ key: "x" })).toBeNull();
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON", getAttribute: (n) => (n === "role" ? "combobox" : null) })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
  });
});

describe("Command bar", () => {
  it("comenzile critice sunt executabile", () => {
    setup();
    expect(runCommand("select-pipes", ctx)).toBe(true);
    expect(S().multiPipes).toHaveLength(1);
    runCommand("select-equipment", ctx);
    expect(S().multi).toHaveLength(2);
    const n = S().scheme.nodes.length;
    runCommand("copy", ctx);
    runCommand("paste", ctx);
    expect(S().scheme.nodes.length).toBe(n + 2);
    runCommand("undo", ctx);
    expect(S().scheme.nodes.length).toBe(n);
    runCommand("redo", ctx);
    expect(S().scheme.nodes.length).toBe(n + 2);
    runCommand("zoom-fit", ctx);
    expect(S().viewRequest?.kind).toBe("fit");
    runCommand("show-critical", ctx);
    expect(S().visualMode).toBe("critical");
    const grid = S().cad.showGrid;
    runCommand("toggle-grid", ctx);
    expect(S().cad.showGrid).toBe(!grid);
    expect(S().recentCommands[0]).toBe("toggle-grid");
  });

  it("Space repetă ultima comandă repetabilă; auto-size selectat", () => {
    setup();
    runCommand("select-equipment", ctx);
    runCommand("duplicate", ctx);
    const n = S().scheme.nodes.length;
    runCommand("repeat", ctx);
    expect(S().scheme.nodes.length).toBe(n + 2);
    S().selectAll("pipes");
    S().bulkPipes({ dn: 15 });
    runCommand("auto-size-selected", ctx);
    expect(S().scheme.pipes[0]!.dn).toBeGreaterThan(15);
  });
});

describe("Find + zoom/select", () => {
  it("caută după tag, tip, DN, material și centrează", () => {
    const { cc, pipe } = setup();
    const s = S().scheme;
    expect(searchObjects(s, cc.tag)[0]!.id).toBe(cc.id);
    expect(searchObjects(s, `dn${pipe.dn}`).map((h) => h.id)).toContain(pipe.id);
    expect(searchObjects(s, "material:carbon").map((h) => h.id)).toEqual([pipe.id]);
    expect(searchObjects(s, "chiller").some((h) => h.kind === "node")).toBe(true);
    expect(searchObjects(s, "inexistent-xyz")).toHaveLength(0);
    const h = searchObjects(s, cc.tag)[0]!;
    S().select({ kind: h.kind, id: h.id });
    S().requestView({ kind: "ids", ids: [h.id] });
    expect(S().selected?.id).toBe(cc.id);
    expect(S().viewRequest).toMatchObject({ kind: "ids", ids: [cc.id] });
  });
});

describe("Straturi", () => {
  it("lock previne mutarea/ștergerea/editarea; visibility nu modifică obiectele", () => {
    const { ch } = setup();
    S().setLayerState("equipment", { locked: true });
    S().moveNodes([ch.id], 50, 0);
    expect(S().scheme.nodes.find((n) => n.id === ch.id)!.x).toBe(ch.x);
    S().updateNode(ch.id, { kw: 999 });
    expect(S().scheme.nodes.find((n) => n.id === ch.id)!.kw).not.toBe(999);
    S().setSelection([ch.id], []);
    S().removeSelected();
    expect(S().scheme.nodes.some((n) => n.id === ch.id)).toBe(true);
    S().setLayerState("equipment", { locked: false, visible: false });
    expect(nodeVisible(S().scheme, S().scheme.nodes[0]!)).toBe(false);
    expect(S().scheme.nodes).toHaveLength(2);
  });

  it("obiectele noi intră în stratul curent dacă îl acceptă", () => {
    S().setCurrentLayer("annotations");
    S().addNode("v_ball", 0, 0);
    expect(S().scheme.nodes[0]!.layer).toBe("annotations");
    S().setCurrentLayer("pipes");
    S().addNode("v_ball", 50, 0);
    expect(S().scheme.nodes[1]!.layer).toBeUndefined(); // stratul „Conducte” nu acceptă noduri → strat implicit
    S().setCurrentLayer("pid");
  });
});

describe("Auto-tag", () => {
  it("protecție la duplicate și warning Engineering Check", () => {
    const { ch, cc } = setup();
    expect(S().renameTag(cc.id, ch.tag)).toBe(false);
    expect(S().renameTag(cc.id, "CCU-77")).toBe(true);
    S().addNode("ccu", 0, 400);
    expect(S().scheme.nodes[2]!.tag).not.toBe("CCU-77");
    // duplicat introdus din date vechi → semnalat
    const dup: Scheme = { ...S().scheme, nodes: S().scheme.nodes.map((n, i) => (i === 2 ? { ...n, tag: "CCU-77" } : n)) };
    expect(duplicateTags(dup).get("CCU-77")).toHaveLength(2);
    const chk = engineeringCheck(dup, fluidProps("water", 0, 10));
    expect(chk.issues.some((i) => /tag duplicat/.test(i.message))).toBe(true);
    S().setSelection(S().scheme.nodes.map((n) => n.id), []);
    S().retagSelected("EQ", 1);
    expect(S().scheme.nodes.map((n) => n.tag).sort()).toEqual(["EQ-01", "EQ-02", "EQ-03"]);
  });
});

describe("Moduri vizuale fără mutații de model", () => {
  it("visual mode / view / find nu modifică schema sau istoricul", () => {
    setup();
    const s0 = S().scheme, h0 = S().history;
    S().setVisualMode("hydraulic");
    S().setVisualMode("check");
    S().requestView({ kind: "fit" });
    S().setFindOpen(true);
    S().setCommandOpen(true);
    S().setSelection([], []);
    expect(S().scheme).toBe(s0);
    expect(S().history).toBe(h0);
    S().setFindOpen(false); S().setCommandOpen(false);
  });
});

describe("Change summary", () => {
  it("created / modified / resized / rerouted / deleted", () => {
    const { pipe, cc } = setup();
    S().updatePipe(pipe.id, { dn: 100 });
    S().updatePipe(pipe.id, { points: [{ x: 300, y: 100 }, { x: 300, y: 300 }] });
    S().setSelection([cc.id], []);
    S().removeSelected();
    const sum = sessionSummary(S().history);
    expect(sum.created.length).toBeGreaterThanOrEqual(3);
    expect(sum.resized).toContain(pipe.tag);
    expect(sum.rerouted).toContain(pipe.tag);
    expect(sum.deleted.length).toBeGreaterThanOrEqual(2);
    expect(S().history.log.at(-1)!.label).toMatch(/Ștergere/);
    const d = diffSchemes(S().history.past[0]!.before, S().scheme);
    expect(d.created.length).toBeGreaterThan(0);
  });
});

describe("Migrare schemă", () => {
  it("date vechi fără câmpuri noi sunt migrate idempotent", () => {
    const old = { id: "x", name: "Vechi", nodes: [{ id: "a", type: "chiller", tag: "CH-01", x: "10", y: 5 }], pipes: [{ id: "p", tag: "T", from: { node: "a", port: "c" }, to: { node: "a", port: "d" }, dn: 50, material: "steel_carbon", joint: "welded", circuit: "supply", length: 3, flow: 2 }] };
    const m = migrateScheme(old);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.nodes[0]!.x).toBe(10);
    expect(m.nodes[0]!.rotation).toBe(0);
    expect(m.pipes[0]!.fittings).toEqual({});
    expect(m.pipes[0]!.routing).toBe("auto");
    expect(m.circuitColors.supply).toBeTruthy();
    expect(m.layers).toEqual({});
    expect(migrateScheme(m)).toEqual({ ...m, updatedAt: m.updatedAt });
    expect(S().importProject(JSON.stringify(old))).toBeNull();
    expect(S().scheme.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("Fără rezultate hidraulice învechite", () => {
  it("schimbarea DN / material / debit se reflectă imediat în solver", () => {
    const { pipe, cc } = setup();
    const fp = fluidProps("water", 0, 10);
    const r0 = solveNetwork(S().scheme, fp).pipes.get(pipe.id)!;
    S().updatePipe(pipe.id, { dn: pipe.dn === 50 ? 80 : 50 });
    const r1 = solveNetwork(S().scheme, fp).pipes.get(pipe.id)!;
    expect(r1.d).not.toBeCloseTo(r0.d, 6);
    S().updatePipe(pipe.id, { material: "steel_inox" });
    const r2 = solveNetwork(S().scheme, fp).pipes.get(pipe.id)!;
    expect(r2.f).not.toBeCloseTo(r1.f, 8);
    S().updateNode(cc.id, { flow: 20 });
    expect(solveNetwork(S().scheme, fp).sourceFlow).toBeCloseTo(20, 6);
    S().undo();
    expect(solveNetwork(S().scheme, fp).sourceFlow).toBeCloseTo(10, 6);
  });
});

describe("Smart routing și module", () => {
  it("rutarea evită echipamentele și este undo-abilă", () => {
    const { ch, cc, pipe } = setup();
    S().addNode("buffer_tank", (ch.x + cc.x) / 2, ch.y - 15);
    const s = S().scheme;
    const p = s.pipes.find((x) => x.id === pipe.id)!;
    const before = routeScore(pipeRoute(p, s), s, p);
    const r = smartRoute(s, p);
    expect(r.score).toBeLessThan(before);
    expect(S().rerouteSelected([pipe.id])).toBe(1);
    expect(S().scheme.pipes.find((x) => x.id === pipe.id)!.points?.length).toBeGreaterThan(0);
    S().undo();
    expect(S().scheme.pipes.find((x) => x.id === pipe.id)!.points).toBeUndefined();
  });

  it("modulele încorporate au conexiuni valide și tag-uri unice la inserare repetată", () => {
    for (const m of BUILTIN_MODULES) {
      for (const p of m.pipes) for (const end of [p.from, p.to]) {
        const n = m.nodes.find((x) => x.id === end.node)!;
        expect(getSymbol(n.type).ports.some((pt) => pt.id === end.port), `${m.id} ${n.type}.${end.port}`).toBe(true);
      }
      S().insertModule(m.id, 400, 300);
      S().insertModule(m.id, 900, 300);
    }
    const s = S().scheme;
    expect(duplicateTags(s).size).toBe(0);
    expect(s.pipes.every((p) => s.nodes.some((n) => n.id === p.from.node) && s.nodes.some((n) => n.id === p.to.node))).toBe(true);
  });
});

describe("Copilot – propunere, preview, apply", () => {
  it("propunerile nu modifică schema până la Apply; Apply = un singur undo", async () => {
    setup();
    const s0 = S().scheme;
    const sel = await localProvider.propose("Select all pipes DN" + s0.pipes[0]!.dn, S());
    expect(sel.mutates).toBe(false);
    applyProposal(sel, S());
    expect(S().multiPipes).toHaveLength(1);
    S().bulkPipes({ dn: 15 });
    const s1 = S().scheme;
    const prop = await localProvider.propose("Auto-size selected", S());
    expect(prop.mutates).toBe(true);
    expect(prop.preview[0]).toMatch(/DN15 → DN/);
    expect(S().scheme).toBe(s1);
    const n0 = S().history.past.length;
    applyProposal(prop, S());
    expect(S().scheme.pipes[0]!.dn).toBeGreaterThan(15);
    expect(S().history.past.length).toBe(n0 + 1);
    S().undo();
    expect(S().scheme.pipes[0]!.dn).toBe(15);
  });
});
