import { CIRCUIT_IDS, CIRCUITS, circuitColor, type CircuitId } from "./catalog";
import { FLUID_LABEL, fluidProps } from "./fluids";
import { getSymbol } from "./symbols";
import { computePipe, circuitTotals } from "./hydraulics";
import { getMaterial, sizeLabel } from "./catalog";
import { pipePower, powerTotals } from "./power";
import { pumpDuty } from "./network";
import { expansionSizing, volumeTotals } from "./volume";
import type { Scheme } from "./types";

export const ascii = (s: string) =>
  s.replace(/[șş]/g, "s").replace(/[ȘŞ]/g, "S").replace(/[țţ]/g, "t").replace(/[ȚŢ]/g, "T")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/°/g, " grd").replace(/·/g, "-")
    .replace(/Δ/g, "d").replace(/³/g, "3").replace(/²/g, "2").replace(/μ/g, "u").replace(/ρ/g, "rho").replace(/λ/g, "lambda");

export function slug(s: string) {
  return ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema";
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Înlocuiește variabilele CSS cu valori concrete, ca desenul să fie valid în afara paginii. */
function resolveVars(root: Element) {
  const cs = getComputedStyle(document.documentElement);
  const val = (name: string) => cs.getPropertyValue(name).trim() || "#0f172a";
  const fix = (v: string) => v.replace(/var\((--[a-z0-9-]+)\)/gi, (_, n: string) => val(n));
  const ink = val("--canvas-ink") || "#dbeafe";
  root.querySelectorAll<SVGElement>("*").forEach((el) => {
    for (const attr of ["fill", "stroke"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      if (v.includes("var(")) el.setAttribute(attr, fix(v));
      else if (v === "currentColor") el.setAttribute(attr, ink);
    }
    const style = el.getAttribute("style");
    if (style?.includes("var(")) el.setAttribute("style", fix(style));
  });
  (root as SVGElement).style.color = ink;
}

/** Construiește un SVG autonom cu întregul desen, decupat pe conținut. */
export function schemeSvgString(svg: SVGSVGElement, pad = 40) {
  const content = svg.querySelector<SVGGElement>("#pid-content");
  if (!content) return null;
  const box = content.getBBox();
  const w = Math.max(200, box.width + pad * 2);
  const h = Math.max(150, box.height + pad * 2);
  const clone = content.cloneNode(true) as SVGGElement;
  clone.removeAttribute("transform");
  // elimină ajutoarele de editare (mânere, porturi, tooltip-uri) — nu fac parte din planșă
  clone.querySelectorAll("[data-ui], title").forEach((el) => el.remove());
  resolveVars(clone);
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() || "#0b1220";
  const wrap = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wrap.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  wrap.setAttribute("width", String(Math.round(w)));
  wrap.setAttribute("height", String(Math.round(h)));
  wrap.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${w} ${h}`);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(box.x - pad));
  rect.setAttribute("y", String(box.y - pad));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("fill", bg);
  wrap.appendChild(rect);
  wrap.appendChild(clone);
  return { markup: new XMLSerializer().serializeToString(wrap), width: w, height: h, bg };
}

export function exportSchemeSvg(svg: SVGSVGElement, name: string) {
  const out = schemeSvgString(svg);
  if (!out) return;
  download(new Blob([out.markup], { type: "image/svg+xml;charset=utf-8" }), `${slug(name)}-schema.svg`);
}

async function rasterize(markup: string, w: number, h: number, scale: number, bg: string) {
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("render"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/png");
}

export async function exportSchemePng(svg: SVGSVGElement, name: string) {
  const out = schemeSvgString(svg);
  if (!out) return;
  const url = await rasterize(out.markup, out.width, out.height, 3, out.bg);
  const blob = await (await fetch(url)).blob();
  download(blob, `${slug(name)}-schema.png`);
}

export interface SchemeStats {
  dpTotal: number; // kPa
  flowMax: number; // m3/h
  lengthTotal: number; // m
}

/** PDF A3 landscape cu desenul, legenda de culori/simboluri și cartușul tehnic. */
export type SvgOut = NonNullable<ReturnType<typeof schemeSvgString>>;

export async function exportSchemePdf(out: SvgOut, coded: SvgOut, scheme: Scheme, stats: SchemeStats) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const W = 420, H = 297, M = 8;
  const png = await rasterize(out.markup, out.width, out.height, 2.5, out.bg);

  // cadru general
  doc.setDrawColor(40);
  doc.setLineWidth(0.6);
  doc.rect(M, M, W - 2 * M, H - 2 * M);

  // zona desen
  const dx = M + 2, dy = M + 2, dw = W - 2 * M - 4, dh = 205;
  const k = Math.min(dw / out.width, dh / out.height);
  const iw = out.width * k, ih = out.height * k;
  doc.addImage(png, "PNG", dx + (dw - iw) / 2, dy + (dh - ih) / 2, iw, ih);
  doc.setDrawColor(150);
  doc.setLineWidth(0.2);
  doc.rect(dx, dy, dw, dh);

  const baseY = dy + dh + 4;

  // legenda circuitelor
  doc.setLineWidth(0.3);
  doc.setDrawColor(40);
  doc.rect(M + 2, baseY, 120, 66);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("LEGENDA CIRCUITE", M + 5, baseY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const used = new Set(scheme.pipes.map((p) => p.circuit));
  let ly = baseY + 12;
  for (const c of CIRCUIT_IDS.filter((c) => used.has(c) || scheme.pipes.length === 0)) {
    doc.setDrawColor(circuitColor(scheme, c));
    doc.setLineWidth(1.4);
    doc.line(M + 5, ly - 1, M + 17, ly - 1);
    doc.setTextColor(30);
    doc.text(ascii(CIRCUITS[c as CircuitId].name), M + 20, ly);
    ly += 6;
  }

  // legenda simbolurilor folosite
  doc.setDrawColor(40);
  doc.setLineWidth(0.3);
  doc.rect(M + 126, baseY, 150, 66);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("LEGENDA SIMBOLURI", M + 129, baseY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const kinds = new Map<string, string>();
  for (const n of scheme.nodes) {
    const s = getSymbol(n.type);
    kinds.set(s.type, `${s.code ?? s.prefix} — ${s.name}`);
  }
  const items = [...kinds.values()].sort();
  const half = Math.ceil(items.length / 2) || 1;
  items.forEach((t, i) => {
    const col = i < half ? 0 : 1;
    const row = i % half;
    doc.text(ascii(t).slice(0, 38), M + 129 + col * 74, baseY + 12 + row * 4.6);
  });

  // cartuș tehnic
  const cx = M + 280, cw = W - 2 * M - 282;
  doc.setLineWidth(0.4);
  doc.rect(cx, baseY, cw, 66);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(ascii(scheme.name).slice(0, 34), cx + 3, baseY + 8);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const rows: [string, string][] = [
    ["Tip plansa", "Schema P&ID - instalatie hidraulica"],
    ["Fluid", `${FLUID_LABEL[scheme.fluid]}${scheme.fluid !== "water" ? ` ${scheme.concentration}%` : ""}`],
    ["Regim", `${scheme.temperature} grd C / dT ${scheme.deltaT} K`],
    ["Densitate / visc.", `${fp.rho.toFixed(0)} kg/m3 / ${(fp.mu * 1000).toFixed(2)} mPa-s`],
    ["Lungime totala", `${stats.lengthTotal.toFixed(1)} m`],
    ["Debit maxim", `${stats.flowMax.toFixed(1)} m3/h`],
    ["dP total circuit", `${stats.dpTotal.toFixed(1)} kPa`],
    ["Revizie / data", `${scheme.revision} / ${new Date().toLocaleDateString("ro-RO")}`],
  ];
  rows.forEach(([k, v], i) => {
    const y = baseY + 15 + i * 6.2;
    doc.setTextColor(110);
    doc.text(ascii(k), cx + 3, y);
    doc.setTextColor(20);
    doc.text(ascii(v).slice(0, 40), cx + 38, y);
  });
  doc.setFontSize(6.5);
  doc.setTextColor(130);
  doc.text("Generat cu P&ID Studio - calcul Darcy-Weisbach / Colebrook-White", cx + 3, baseY + 63);

  // pagina 2+: calculul hidraulic aferent desenului
  const autoTable = (await import("jspdf-autotable")).default;
  doc.addPage("a3", "landscape");
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(ascii(`Calcul hidraulic - ${scheme.name}`), M + 4, M + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const pw = powerTotals(scheme);
  doc.text(ascii(`Fluid: ${FLUID_LABEL[scheme.fluid]}${scheme.fluid !== "water" ? ` ${scheme.concentration}%` : ""} la ${scheme.temperature} grd C · rho ${fp.rho.toFixed(1)} kg/m3 · nu ${(fp.nu * 1e6).toFixed(3)} mm2/s`), M + 4, M + 17);
  doc.text(ascii(`Putere sensibila instalata ${pw.sensInstalled.toFixed(1)} kW · Putere sensibila activa ${pw.sensActive.toFixed(1)} kW · Putere necesara ${pw.required.toFixed(1)} kW · Putere furnizata ${pw.supplied.toFixed(1)} kW${pw.deficit ? " (INSUFICIENTA)" : ""}`), M + 4, M + 23);
  const off = scheme.pipes.filter((p) => p.disabled).map((p) => p.tag);
  if (off.length) doc.text(ascii(`Tronsoane scoase din functiune (scenariu inel): ${off.join(", ")}`), M + 4, M + 29);
  const active = scheme.pipes.filter((p) => !p.disabled);
  autoTable(doc, {
    startY: M + 33,
    head: [["Tag", "Material / DN", "L [m]", "Q [m3/h]", "P [kW]", "v [m/s]", "Re", "lambda", "R [Pa/m]", "Suma K", "dp lin [kPa]", "dp loc [kPa]", "dp elem [kPa]", "dp total [kPa]"]],
    body: active.map((p) => {
      const r = computePipe(p, scheme, fp);
      return [p.tag + (p.direct ? " (direct)" : ""), ascii(`${getMaterial(p.material).short} ${sizeLabel(p.material, p.dn)}`), r.L.toFixed(1), p.flow.toFixed(2),
        pipePower(p, scheme, fp).toFixed(1), r.v.toFixed(2) + (r.velWarn ? " !" : ""), Math.round(r.Re).toString(), r.f.toFixed(4), r.R.toFixed(0), r.Ksum.toFixed(2),
        (r.dpLin / 1000).toFixed(2), (r.dpLoc / 1000).toFixed(2), (r.dpComp / 1000).toFixed(2), (r.dpTotal / 1000).toFixed(2)];
    }),
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  const tot = circuitTotals(scheme, fp);
  autoTable(doc, {
    head: [["Circuit", "Segmente", "Lungime [m]", "dp [kPa]"]],
    body: [...tot.entries()].map(([c, v]) => [ascii(CIRCUITS[c as CircuitId].name), String(v.n), v.L.toFixed(1), (v.dp / 1000).toFixed(2)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    tableWidth: 160,
  });

  // sinteza: traseu critic, pompa, volum de fluid, vas de expansiune
  const duty = pumpDuty(scheme, fp);
  const vol = volumeTotals(scheme);
  const exp = expansionSizing(scheme);
  const tagOf = (id: string) => scheme.pipes.find((p) => p.id === id)?.tag ?? "";
  const synth: [string, string][] = [
    ["Traseu critic", duty.path ? ascii(`${duty.path.pipes.map(tagOf).join(" > ")} -> ${duty.path.endTag}`).slice(0, 90) : "-"],
    ["dP traseu critic", `${(duty.dpCritical / 1000).toFixed(1)} kPa`],
    ["Presiune utila modul integrat", `${(duty.integratedHead / 1000).toFixed(0)} kPa`],
    ["Sarcina pompei exterioare", `${(duty.net / 1000).toFixed(1)} kPa = ${duty.headM.toFixed(1)} mCA (cu marja: ${duty.margin.toFixed(1)} mCA)`],
    ["Debit total instalatie", `${duty.flow.toFixed(2)} m3/h`],
    ["Volum fluid conducte / echipamente", `${vol.pipes.toFixed(0)} l / ${vol.equipment.toFixed(0)} l`],
    ["Volum total instalatie", `${vol.total.toFixed(0)} l`],
    ["Umplere", `${vol.water.toFixed(0)} l apa + ${vol.glycolPure.toFixed(0)} l glicol pur`],
    ["Vas expansiune necesar", `V utile ${exp.utilVolume.toFixed(0)} l -> nominal ${exp.nominal} l (p0 ${(exp.p0 - 1).toFixed(1)} / pe ${(exp.pe - 1).toFixed(1)} bar)`],
    ["Vas expansiune prevazut", `${exp.installed.toFixed(0)} l${exp.ok ? " (acoperitor)" : " (INSUFICIENT)"}`],
  ];
  autoTable(doc, {
    head: [["Sinteza calcul", "Valoare"]],
    body: synth.map(([k, v]) => [k, v]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    tableWidth: 240,
  });



  // ultima pagină: desenul cu codurile și tag-urile elementelor
  doc.addPage("a3", "landscape");
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(ascii(`${scheme.name} - schema cu coduri si tag-uri`), M + 4, M + 9);
  const png2 = await rasterize(coded.markup, coded.width, coded.height, 2.5, coded.bg);
  const cw2 = W - 2 * M - 8, ch2 = H - 2 * M - 18;
  const k2 = Math.min(cw2 / coded.width, ch2 / coded.height);
  const w2 = coded.width * k2, h2 = coded.height * k2;
  doc.addImage(png2, "PNG", M + 4 + (cw2 - w2) / 2, M + 13 + (ch2 - h2) / 2, w2, h2);
  doc.setDrawColor(40);
  doc.setLineWidth(0.6);
  doc.rect(M, M, W - 2 * M, H - 2 * M);

  doc.save(`${slug(scheme.name)}-schema.pdf`);
}

export function exportProjectFile(scheme: Scheme) {
  download(new Blob([JSON.stringify(scheme, null, 2)], { type: "application/json" }), `${slug(scheme.name)}.pid.json`);
}

/* ---------- DXF (AutoCAD R12, ASCII) ---------- */
const ACI: [number, number, number, number][] = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255],
  [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [40, 255, 191, 0], [140, 0, 127, 255], [150, 0, 63, 255], [210, 255, 0, 191],
];
function aci(color: string | null) {
  if (!color) return 7;
  const cv = document.createElement("canvas").getContext("2d")!;
  cv.fillStyle = color;
  const hex = cv.fillStyle as string;
  if (!hex.startsWith("#")) return 7;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  let best = 7, bd = Infinity;
  for (const [i, R, G, B] of ACI) { const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/** Export DXF din desenul afișat: geometria simbolurilor, conductele și textele. 1 unitate = 1 px (40 px = 1 m). */
export function exportSchemeDxf(svg: SVGSVGElement, name: string) {
  const content = svg.querySelector<SVGGElement>("#pid-content");
  if (!content) return;
  const base = content.getCTM()!.inverse();
  const out: string[] = [];
  const e = (...kv: (string | number)[]) => { for (let i = 0; i < kv.length; i += 2) out.push(String(kv[i]), typeof kv[i + 1] === "number" ? (kv[i + 1] as number).toFixed(3).replace(/\.?0+$/, "") || "0" : String(kv[i + 1])); };
  const cs = getComputedStyle(document.documentElement);
  const resolve = (v: string | null) => {
    if (!v) return null;
    const m = v.match(/var\((--[a-z0-9-]+)\)/i);
    if (m) return cs.getPropertyValue(m[1]!).trim();
    if (v === "currentColor") return cs.getPropertyValue("--canvas-ink").trim();
    return v;
  };
  const visible = (el: Element, attr: "stroke" | "fill") => {
    const v = el.getAttribute(attr) ?? getComputedStyle(el)[attr];
    return v && v !== "none" && v !== "transparent" ? resolve(v) : null;
  };
  const layerOf = (el: Element) => (el.closest("[data-layer]")?.getAttribute("data-layer") ?? "PID").replace(/[^A-Za-z0-9_-]/g, "_");
  const poly = (pts: DOMPoint[], closed: boolean, color: number, layer: string) => {
    if (pts.length < 2) return;
    e(0, "POLYLINE", 8, layer, 62, color, 66, 1, 70, closed ? 1 : 0);
    for (const p of pts) e(0, "VERTEX", 8, layer, 10, p.x, 20, -p.y, 30, 0);
    e(0, "SEQEND", 8, layer);
  };
  content.querySelectorAll<SVGGraphicsElement>("path,line,rect,circle,ellipse,polyline,polygon,text").forEach((el) => {
    // fără elemente de interfață: mânere de tragere, porturi, tooltip-uri, selecții
    if (el.closest("title") || el.closest("[data-ui]")) return;
    const ctm = el.getCTM();
    if (!ctm) return;
    const m = base.multiply(ctm);
    const tp = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(m);
    const layer = layerOf(el);
    if (el.tagName === "text") {
      const t = el.textContent?.trim();
      if (!t) return;
      const fs = parseFloat(el.getAttribute("font-size") ?? "10");
      const bb = (el as SVGTextElement).getBBox();
      const p = tp(bb.x, bb.y + bb.height * 0.8);
      e(0, "TEXT", 8, layer, 62, aci(visible(el, "fill")), 10, p.x, 20, -p.y, 30, 0, 40, fs * 0.75, 1, ascii(t));
      return;
    }
    const color = visible(el, "stroke") ?? visible(el, "fill");
    if (!color) return;
    const c = aci(color);
    if (el.tagName === "circle") {
      const cx = +el.getAttribute("cx")!, cy = +el.getAttribute("cy")!, r = +el.getAttribute("r")!;
      const p = tp(cx, cy);
      e(0, "CIRCLE", 8, layer, 62, c, 10, p.x, 20, -p.y, 30, 0, 40, r * Math.hypot(m.a, m.b));
      return;
    }
    if (el.tagName === "line") {
      const a = tp(+el.getAttribute("x1")!, +el.getAttribute("y1")!), b = tp(+el.getAttribute("x2")!, +el.getAttribute("y2")!);
      e(0, "LINE", 8, layer, 62, c, 10, a.x, 20, -a.y, 30, 0, 11, b.x, 21, -b.y, 31, 0);
      return;
    }
    if (el.tagName === "rect") {
      const x = +(el.getAttribute("x") ?? 0), y = +(el.getAttribute("y") ?? 0), w = +el.getAttribute("width")!, h = +el.getAttribute("height")!;
      if (!w || !h) return;
      poly([tp(x, y), tp(x + w, y), tp(x + w, y + h), tp(x, y + h)], true, c, layer);
      return;
    }
    // path / ellipse / polyline / polygon → eșantionare pe lungime
    const g = el as SVGGeometryElement;
    const L = g.getTotalLength?.() ?? 0;
    if (!L) return;
    const d = el.getAttribute("d") ?? "";
    const curved = /[AaCcQqSsTt]/.test(d) || el.tagName === "ellipse";
    const pts: DOMPoint[] = [];
    if (!curved && el.tagName === "path") {
      const nums = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
      let cmd = "M", cx = 0, cy = 0, i = 0, sx = 0, sy = 0;
      const flush = () => { if (pts.length > 1) poly(pts.splice(0), false, c, layer); else pts.splice(0); };
      while (i < nums.length) {
        const tk = nums[i]!;
        if (/[A-Za-z]/.test(tk)) { cmd = tk; i++; if (cmd === "Z" || cmd === "z") { pts.push(tp(sx, sy)); flush(); } continue; }
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        if (C === "H") { cx = +tk + (rel ? cx : 0); i++; }
        else if (C === "V") { cy = +tk + (rel ? cy : 0); i++; }
        else { cx = +tk + (rel ? cx : 0); cy = +nums[i + 1]! + (rel ? cy : 0); i += 2; }
        if (C === "M") { flush(); sx = cx; sy = cy; cmd = rel ? "l" : "L"; }
        pts.push(tp(cx, cy));
      }
      flush();
      return;
    }
    const n = Math.min(200, Math.max(8, Math.ceil(L / 3)));
    for (let k = 0; k <= n; k++) { const p = g.getPointAtLength((L * k) / n); pts.push(tp(p.x, p.y)); }
    poly(pts, false, c, layer);
  });
  const dxf = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...out, "0", "ENDSEC", "0", "EOF"].join("\r\n");
  download(new Blob([dxf], { type: "application/dxf" }), `${slug(name)}-schema.dxf`);
}
