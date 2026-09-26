import type { ReactNode } from "react";

export type SymbolCategory = "Echipamente" | "Pompe" | "Vane" | "Instrumentație" | "Fitinguri";

export interface SymbolDef {
  type: string;
  name: string;
  category: SymbolCategory;
  prefix: string; // tag prefix (ISA)
  w: number;
  h: number;
  ports: { id: string; x: number; y: number }[];
  K?: number; // local resistance when inline
  dpDefault?: number; // kPa
  bomGroup: "Echipamente" | "Vane" | "Instrumente" | "Fitinguri";
  render: () => ReactNode;
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinejoin: "round" as const };
const inline2 = [{ id: "a", x: 0, y: 20 }, { id: "b", x: 60, y: 20 }];

const bowtie = (extra?: ReactNode, filled = false) => (
  <g>
    <line x1={0} y1={20} x2={12} y2={20} {...S} />
    <line x1={48} y1={20} x2={60} y2={20} {...S} />
    <path d="M12 8 L48 32 L48 8 L12 32 Z" {...S} fill={filled ? "currentColor" : "var(--canvas-bg)"} />
    {extra}
  </g>
);

const defs = [
  // Pumps
  { type: "pump_centrifugal", name: "Pompă centrifugă", category: "Pompe", prefix: "P", w: 60, h: 60, bomGroup: "Echipamente",
    ports: [{ id: "a", x: 0, y: 30 }, { id: "b", x: 30, y: 0 }], dpDefault: 0,
    render: () => (<g><circle cx={30} cy={30} r={22} {...S} fill="var(--canvas-bg)" /><path d="M30 8 L52 30" {...S} /><path d="M30 8 L8 30" {...S} /><line x1={0} y1={30} x2={8} y2={30} {...S} /><line x1={30} y1={0} x2={30} y2={8} {...S} /><path d="M14 52 L46 52 L40 44 L20 44 Z" {...S} /></g>) },
  { type: "pump_inline", name: "Pompă circulație inline", category: "Pompe", prefix: "P", w: 60, h: 40, bomGroup: "Echipamente", ports: inline2,
    render: () => (<g><line x1={0} y1={20} x2={12} y2={20} {...S} /><line x1={48} y1={20} x2={60} y2={20} {...S} /><circle cx={30} cy={20} r={18} {...S} fill="var(--canvas-bg)" /><path d="M22 10 L40 20 L22 30" {...S} /></g>) },
  { type: "pump_twin", name: "Pompă dublă", category: "Pompe", prefix: "P", w: 60, h: 40, bomGroup: "Echipamente", ports: inline2,
    render: () => (<g><line x1={0} y1={20} x2={6} y2={20} {...S} /><line x1={54} y1={20} x2={60} y2={20} {...S} /><circle cx={19} cy={20} r={13} {...S} fill="var(--canvas-bg)" /><circle cx={41} cy={20} r={13} {...S} fill="var(--canvas-bg)" /><path d="M14 13 L26 20 L14 27" {...S} /><path d="M36 13 L48 20 L36 27" {...S} /></g>) },
  // Equipment
  { type: "chiller", name: "Chiller", category: "Echipamente", prefix: "CH", w: 120, h: 70, bomGroup: "Echipamente", dpDefault: 45,
    ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 0, y: 50 }, { id: "c", x: 120, y: 20 }, { id: "d", x: 120, y: 50 }],
    render: () => (<g><rect x={4} y={4} width={112} height={62} rx={4} {...S} fill="var(--canvas-bg)" /><path d="M20 35 h80 M30 20 l10 15 -10 15 M90 20 l-10 15 10 15" {...S} strokeWidth={1.5} /><text x={60} y={62} textAnchor="middle" fontSize={9} fill="currentColor">CHILLER</text><line x1={0} y1={20} x2={4} y2={20} {...S} /><line x1={0} y1={50} x2={4} y2={50} {...S} /><line x1={116} y1={20} x2={120} y2={20} {...S} /><line x1={116} y1={50} x2={120} y2={50} {...S} /></g>) },
  { type: "boiler", name: "Cazan", category: "Echipamente", prefix: "B", w: 70, h: 90, bomGroup: "Echipamente", dpDefault: 15,
    ports: [{ id: "a", x: 35, y: 0 }, { id: "b", x: 35, y: 90 }],
    render: () => (<g><rect x={5} y={5} width={60} height={80} rx={6} {...S} fill="var(--canvas-bg)" /><path d="M25 65 q10 -25 10 -30 q10 15 10 30 z" {...S} /><line x1={35} y1={0} x2={35} y2={5} {...S} /><line x1={35} y1={85} x2={35} y2={90} {...S} /></g>) },
  { type: "hex_plate", name: "Schimbător în plăci", category: "Echipamente", prefix: "HE", w: 60, h: 80, bomGroup: "Echipamente", dpDefault: 25,
    ports: [{ id: "a", x: 0, y: 15 }, { id: "b", x: 0, y: 65 }, { id: "c", x: 60, y: 15 }, { id: "d", x: 60, y: 65 }],
    render: () => (<g><rect x={6} y={4} width={48} height={72} {...S} fill="var(--canvas-bg)" />{[16, 24, 32, 40].map((x) => <line key={x} x1={x} y1={8} x2={x} y2={72} {...S} strokeWidth={1} />)}<path d="M6 76 L54 4" {...S} strokeWidth={1} /><line x1={0} y1={15} x2={6} y2={15} {...S} /><line x1={0} y1={65} x2={6} y2={65} {...S} /><line x1={54} y1={15} x2={60} y2={15} {...S} /><line x1={54} y1={65} x2={60} y2={65} {...S} /></g>) },
  { type: "hex_shell", name: "Schimbător manta-tub", category: "Echipamente", prefix: "HE", w: 100, h: 50, bomGroup: "Echipamente", dpDefault: 30,
    ports: [{ id: "a", x: 0, y: 25 }, { id: "b", x: 100, y: 25 }, { id: "c", x: 30, y: 0 }, { id: "d", x: 70, y: 50 }],
    render: () => (<g><rect x={8} y={8} width={84} height={34} rx={17} {...S} fill="var(--canvas-bg)" /><path d="M8 25 h14 l8 -10 l10 20 l10 -20 l10 20 l10 -20 l8 10 h14" {...S} strokeWidth={1.5} /><line x1={0} y1={25} x2={8} y2={25} {...S} /><line x1={92} y1={25} x2={100} y2={25} {...S} /><line x1={30} y1={0} x2={30} y2={8} {...S} /><line x1={70} y1={42} x2={70} y2={50} {...S} /></g>) },
  { type: "buffer_tank", name: "Rezervor tampon", category: "Echipamente", prefix: "TK", w: 60, h: 110, bomGroup: "Echipamente", dpDefault: 2,
    ports: [{ id: "a", x: 0, y: 25 }, { id: "b", x: 0, y: 85 }, { id: "c", x: 60, y: 25 }, { id: "d", x: 60, y: 85 }],
    render: () => (<g><rect x={6} y={5} width={48} height={100} rx={24} {...S} fill="var(--canvas-bg)" /><line x1={0} y1={25} x2={6} y2={25} {...S} /><line x1={0} y1={85} x2={6} y2={85} {...S} /><line x1={54} y1={25} x2={60} y2={25} {...S} /><line x1={54} y1={85} x2={60} y2={85} {...S} /></g>) },
  { type: "expansion", name: "Vas de expansiune", category: "Echipamente", prefix: "EV", w: 50, h: 70, bomGroup: "Echipamente",
    ports: [{ id: "a", x: 25, y: 70 }],
    render: () => (<g><rect x={5} y={5} width={40} height={55} rx={20} {...S} fill="var(--canvas-bg)" /><path d="M5 32 q10 -6 20 0 t20 0" {...S} strokeWidth={1.5} /><line x1={25} y1={60} x2={25} y2={70} {...S} /></g>) },
  { type: "ahu_coil", name: "Baterie răcire/încălzire", category: "Echipamente", prefix: "CL", w: 60, h: 60, bomGroup: "Echipamente", dpDefault: 20,
    ports: [{ id: "a", x: 0, y: 15 }, { id: "b", x: 0, y: 45 }],
    render: () => (<g><rect x={6} y={4} width={50} height={52} {...S} fill="var(--canvas-bg)" /><path d="M6 4 L56 56 M56 4 L6 56" {...S} strokeWidth={1} /><line x1={0} y1={15} x2={6} y2={15} {...S} /><line x1={0} y1={45} x2={6} y2={45} {...S} /></g>) },
  // Valves
  { type: "v_gate", name: "Vană izolare", category: "Vane", prefix: "V", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 0.15, render: () => bowtie() },
  { type: "v_ball", name: "Robinet cu sferă", category: "Vane", prefix: "BV", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 0.05, render: () => bowtie(<circle cx={30} cy={20} r={6} fill="currentColor" />) },
  { type: "v_butterfly", name: "Vană fluture", category: "Vane", prefix: "BFV", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 0.5,
    render: () => bowtie(<g><line x1={30} y1={6} x2={30} y2={34} {...S} /><circle cx={30} cy={20} r={3} fill="currentColor" /></g>) },
  { type: "v_control", name: "Vană de reglaj", category: "Vane", prefix: "CV", w: 60, h: 60, bomGroup: "Vane", K: 6,
    ports: [{ id: "a", x: 0, y: 40 }, { id: "b", x: 60, y: 40 }],
    render: () => (<g transform="translate(0,20)">{bowtie(<g><line x1={30} y1={20} x2={30} y2={-6} {...S} /><path d="M18 -6 a12 12 0 0 1 24 0 z" {...S} fill="var(--canvas-bg)" /></g>)}</g>) },
  { type: "v_balancing", name: "Vană echilibrare", category: "Vane", prefix: "BLV", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 3,
    render: () => bowtie(<path d="M22 36 L38 4 M34 4 h4 v4" {...S} strokeWidth={1.5} />) },
  { type: "v_check", name: "Clapetă de reținere", category: "Vane", prefix: "NRV", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 2,
    render: () => (<g><line x1={0} y1={20} x2={12} y2={20} {...S} /><line x1={48} y1={20} x2={60} y2={20} {...S} /><path d="M12 8 L48 32 L48 8 L12 32 Z" {...S} fill="var(--canvas-bg)" /><path d="M12 8 L12 32 L30 20 Z" fill="currentColor" /></g>) },
  { type: "v_safety", name: "Supapă de siguranță", category: "Vane", prefix: "PSV", w: 50, h: 60, bomGroup: "Vane",
    ports: [{ id: "a", x: 25, y: 60 }],
    render: () => (<g><path d="M13 48 L37 48 L25 28 Z M25 28 L45 18 L45 38 Z" {...S} fill="var(--canvas-bg)" /><path d="M25 28 v-18 m-6 0 l6 -6 l6 6 m-10 4 l8 4 l-8 4 l8 4" {...S} strokeWidth={1.5} /><line x1={25} y1={48} x2={25} y2={60} {...S} /></g>) },
  { type: "strainer", name: "Filtru Y", category: "Vane", prefix: "STR", w: 60, h: 40, bomGroup: "Vane", ports: inline2, K: 2,
    render: () => (<g><line x1={0} y1={20} x2={60} y2={20} {...S} /><path d="M20 20 L36 36 L42 30 L28 14" {...S} fill="var(--canvas-bg)" /><path d="M24 22 l10 10" {...S} strokeDasharray="2 2" strokeWidth={1} /></g>) },
  // Instruments (ISA bubble)
  ...([
    ["i_pg", "Manometru", "PI"], ["i_ps", "Presostat", "PS"], ["i_pt", "Traductor presiune", "PT"],
    ["i_ti", "Termometru", "TI"], ["i_tt", "Senzor temperatură", "TT"], ["i_ft", "Debitmetru", "FT"],
    ["i_fs", "Fluxostat", "FS"], ["i_dpt", "Traductor Δp", "PDT"],
  ] as const).map(([type, name, prefix]) => ({
    type, name, category: "Instrumentație" as const, prefix, w: 44, h: 60, bomGroup: "Instrumente" as const,
    ports: [{ id: "a", x: 22, y: 60 }],
    render: () => (<g><circle cx={22} cy={22} r={18} {...S} fill="var(--canvas-bg)" /><line x1={4} y1={22} x2={40} y2={22} {...S} strokeWidth={1} /><text x={22} y={18} textAnchor="middle" fontSize={10} fontWeight={600} fill="currentColor">{prefix}</text><line x1={22} y1={40} x2={22} y2={60} {...S} strokeDasharray="3 2" /></g>),
  })),
  { type: "i_flowmeter_inline", name: "Debitmetru inline", category: "Instrumentație", prefix: "FE", w: 60, h: 40, bomGroup: "Instrumente", ports: inline2, K: 0.2,
    render: () => (<g><line x1={0} y1={20} x2={60} y2={20} {...S} /><rect x={16} y={8} width={28} height={24} {...S} fill="var(--canvas-bg)" /><text x={30} y={24} textAnchor="middle" fontSize={10} fill="currentColor">FE</text></g>) },
  // Fittings
  { type: "tee", name: "Teu", category: "Fitinguri", prefix: "T", w: 40, h: 40, bomGroup: "Fitinguri", K: 0.4,
    ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 40, y: 20 }, { id: "c", x: 20, y: 40 }],
    render: () => (<g><line x1={0} y1={20} x2={40} y2={20} {...S} /><line x1={20} y1={20} x2={20} y2={40} {...S} /><circle cx={20} cy={20} r={3} fill="currentColor" /></g>) },
  { type: "reducer", name: "Reducție", category: "Fitinguri", prefix: "R", w: 40, h: 40, bomGroup: "Fitinguri", ports: [{ id: "a", x: 0, y: 20 }, { id: "b", x: 40, y: 20 }], K: 0.3,
    render: () => (<g><path d="M0 20 h8 M32 20 h8 M8 8 L32 14 L32 26 L8 32 Z" {...S} fill="var(--canvas-bg)" /></g>) },
  { type: "air_vent", name: "Aerisitor automat", category: "Fitinguri", prefix: "AV", w: 30, h: 40, bomGroup: "Fitinguri", ports: [{ id: "a", x: 15, y: 40 }],
    render: () => (<g><rect x={5} y={6} width={20} height={20} rx={3} {...S} fill="var(--canvas-bg)" /><path d="M15 6 v-5" {...S} /><line x1={15} y1={26} x2={15} y2={40} {...S} /></g>) },
  { type: "drain", name: "Golire / drenaj", category: "Fitinguri", prefix: "DR", w: 30, h: 40, bomGroup: "Fitinguri", ports: [{ id: "a", x: 15, y: 0 }],
    render: () => (<g><line x1={15} y1={0} x2={15} y2={20} {...S} /><path d="M5 20 L25 20 L15 34 Z" {...S} fill="var(--canvas-bg)" /></g>) },
] satisfies SymbolDef[];

export type SymbolType = (typeof defs)[number]["type"];
export const SYMBOLS = Object.fromEntries(defs.map((d) => [d.type, d])) as Record<SymbolType, SymbolDef>;
export const SYMBOL_LIST: SymbolDef[] = defs;
