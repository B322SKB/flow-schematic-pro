import { COUPLING_SPACING, FITTINGS, getMaterial, JOINT_LABEL, sizeLabel, type FittingId } from "./catalog";
import { autoBends, riserRise } from "./hydraulics";
import { getSymbol } from "./symbols";
import type { Scheme } from "./types";

export interface BomRow {
  group: string;
  item: string;
  code: string;
  spec: string;
  qty: number;
  unit: string;
  tags: string;
}

/** Denumirea îmbinării în funcție de tehnologia aleasă. */
function jointItem(joint: Scheme["pipes"][number]["joint"]) {
  return joint === "grooved" ? "Cuplă canelată (Victaulic)" :
    joint === "flanged" ? "Set flanșe + garnitură + șuruburi" :
    joint === "welded" ? "Sudură cap la cap" :
    joint === "threaded" ? "Îmbinare filetată (mufă/racord)" : "Manșon electrofuziune";
}

export function buildBom(scheme: Scheme): BomRow[] {
  const map = new Map<string, BomRow>();
  const add = (group: string, item: string, code: string, spec: string, qty: number, unit: string, tag?: string) => {
    const key = `${group}|${item}|${code}|${spec}|${unit}`;
    const r = map.get(key) ?? { group, item, code, spec, qty: 0, unit, tags: "" };
    r.qty += qty;
    if (tag) r.tags = r.tags ? `${r.tags}, ${tag}` : tag;
    map.set(key, r);
  };

  for (const p of scheme.pipes) {
    if (p.direct) continue;
    const m = getMaterial(p.material);
    const size = sizeLabel(p.material, p.dn);
    const jl = JOINT_LABEL[p.joint];
    const len = p.length + Math.abs(riserRise(p, scheme));
    add("1. Conducte", `Țeavă ${m.short}`, `DN${p.dn}`, `${size} · ${jl}`, len, "m", p.tag);
    const bends = autoBends(p, scheme);
    const fits: Partial<Record<FittingId, number>> = { ...p.fittings };
    fits.elbow90 = (fits.elbow90 ?? 0) + bends;
    let fittingCount = 0;
    for (const [k, n] of Object.entries(fits)) {
      if (!n) continue;
      fittingCount += n;
      add("2. Fitinguri", FITTINGS[k as FittingId].name, `DN${p.dn}`, `${m.short} ${size} · ${jl}`, n, "buc");
    }
    const unit = p.joint === "welded" ? "sudură" : "buc";
    // cuple pe tronson: 2 la capete + intermediare la pas de 2 m
    const ends = 2 + Math.max(0, Math.ceil(len / COUPLING_SPACING) - 1);
    add("3. Îmbinări", jointItem(p.joint), `DN${p.dn}`, `${m.short} ${size} · tronson (capete + pas ${COUPLING_SPACING} m)`, ends, unit, p.tag);
    // cuple pe fitingurile din traseu: 2 per fiting
    if (fittingCount) {
      add("3. Îmbinări", jointItem(p.joint), `DN${p.dn}`, `${m.short} ${size} · fitinguri traseu (2/fiting)`, fittingCount * 2, unit);
    }
  }

  // cuple la racordurile elementelor (vane, fitinguri, echipamente)
  for (const n of scheme.nodes) {
    const s = getSymbol(n.type);
    if (s.bomGroup === "Instrumente") continue;
    for (const p of scheme.pipes) {
      if (p.from.node !== n.id && p.to.node !== n.id) continue;
      const m = getMaterial(p.material);
      add("3. Îmbinări", jointItem(p.joint), `DN${p.dn}`,
        `${m.short} ${sizeLabel(p.material, p.dn)} · racord element`, 1,
        p.joint === "welded" ? "sudură" : "buc", n.tag);
    }
  }

  for (const n of scheme.nodes) {
    const s = getSymbol(n.type);
    const pipe = scheme.pipes.find((p) => p.from.node === n.id || p.to.node === n.id);
    const dn = n.dn ?? pipe?.dn;
    const specParts: string[] = [];
    if (s.bomGroup === "Echipamente") {
      if (n.kwSens) specParts.push(`${n.kwSens} kW sensibil`);
      if (n.kw) specParts.push(`${n.kw} kW`);
      if (n.volume) specParts.push(`${n.volume} l`);
      if (s.terminal || s.source) specParts.push(n.redundant ? "redundant" : "activ");
      if (n.flow) specParts.push(`${n.flow} m³/h`);
      if (n.dpFixed) specParts.push(`Δp ${n.dpFixed} kPa`);
      if (s.source && n.intPump) {
        specParts.push(`modul hidraulic integrat: pompă ${n.intPump === "twin" ? "dublă (1A+1R)" : "simplă"}`);
        if (n.pumpHead) specParts.push(`presiune utilă ${n.pumpHead} kPa`);
      }
      if (n.note) specParts.push(n.note);
    } else if (dn) specParts.push(`DN${dn}`);
    if (s.riser && n.z) specParts.push(`${s.riser === "up" ? "+" : "-"}${Math.abs(n.z)} m`);
    const grp = s.bomGroup === "Echipamente" ? "4. Echipamente" : s.bomGroup === "Vane" ? "5. Vane" : s.bomGroup === "Instrumente" ? "6. Instrumente" : "2. Fitinguri";
    add(grp, s.name, s.code ?? "", specParts.join(" · ") || "—", 1, "buc", n.tag);
  }

  return [...map.values()]
    .map((r) => ({ ...r, qty: r.unit === "m" ? Math.round(r.qty * 10) / 10 : r.qty }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.item.localeCompare(b.item) || a.spec.localeCompare(b.spec, undefined, { numeric: true }));
}


const HEAD = ["Grupă", "Articol", "Cod", "Specificație", "Cantitate", "UM", "Tag-uri"];
const rowArr = (r: BomRow) => [r.group, r.item, r.code, r.spec, r.qty, r.unit, r.tags];


export async function exportXlsx(rows: BomRow[], name: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows.map(rowArr)]);
  ws["!cols"] = [{ wch: 16 }, { wch: 32 }, { wch: 8 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BOM-MTO");
  XLSX.writeFile(wb, `${slug(name)}-BOM.xlsx`);
}

export function exportCsv(rows: BomRow[], name: string) {
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [HEAD, ...rows.map(rowArr)].map((r) => r.map(esc).join(";")).join("\n");
  download(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${slug(name)}-BOM.csv`);
}

const ascii = (s: string) =>
  s.replace(/[șş]/g, "s").replace(/[ȘŞ]/g, "S").replace(/[țţ]/g, "t").replace(/[ȚŢ]/g, "T")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/°/g, " grd").replace(/·/g, "-");

export async function exportPdf(rows: BomRow[], name: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(ascii(`Lista de cantitati (BOM / MTO) - ${name}`), 14, 15);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString("ro-RO"), 14, 21);
  autoTable(doc, {
    startY: 26,
    head: [HEAD.map(ascii)],
    body: rows.map((r) => rowArr(r).map((v) => ascii(String(v)))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  doc.save(`${slug(name)}-BOM.pdf`);
}

function slug(s: string) { return ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema"; }
function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
