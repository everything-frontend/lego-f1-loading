export interface LegoF1Options {
  scale?: number;
  color?: string;
  baseColor?: string;
  /** Scene background (canvas + surface); hex like `#f4f6f9`. Default light gray. */
  backgroundColor?: string;
  /** Background opacity: 0 = fully transparent, 1 = opaque. Default 1. */
  backgroundOpacity?: number;
  text?: string | string[];
  textInterval?: number;
  /** Assembly tempo: 1 = default; higher = faster snap-in (stagger + per-brick motion). Clamped ~0.15–5. */
  assembleSpeed?: number;
}

export interface LegoF1Controller {
  start: () => void;
  complete: () => void;
  reset: () => void;
  setScale: (scale: number) => void;
  setBackgroundColor: (hex: string) => void;
  setBackgroundOpacity: (opacity: number) => void;
  destroy: () => void;
}

const STYLE_ID = "ef-lego-f1-styles";

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ef-lf1-root {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-height: 1px;
}
.ef-lf1-surface {
  width: 300px;
  height: 110px;
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, #fcfcfd 0%, #f5f7fa 50%, #eef1f6 100%);
}
.ef-lf1-surface canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.ef-lf1-text {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(15, 23, 42, 0.42);
  text-align: center;
  min-height: 1em;
  max-width: min(300px, 100%);
  transition: color 0.25s ease, letter-spacing 0.25s ease;
}
.ef-lf1-root[data-ef-lf1-state="done"] .ef-lf1-text {
  color: rgba(15, 23, 42, 0.58);
  letter-spacing: 0.045em;
}
`;
  document.head.appendChild(style);
}

const W = 300;
const H = 110;

/** Visual style: classic studs, Technic beams (holes), slick panels, connector pins, thin axles, or wheel. */
type PieceKind = "stud" | "technic" | "panel" | "pin" | "axle" | "wheel";

interface Brick {
  targetX: number;
  targetY: number;
  scatterX: number;
  scatterY: number;
  scatterRotation: number;
  w: number;
  h: number;
  color: string;
  kind: PieceKind;
}

function adjustColor(hex: string, amount: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const num = parseInt(h, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const DEFAULT_BACKGROUND = "#f4f6f9";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || !/^[0-9a-fA-F]+$/.test(h)) return null;
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function hexToRgbaString(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, alpha));
  if (!rgb) return `rgba(0,0,0,${a})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

function clampBackgroundOpacity(raw: number | undefined): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/** WCAG relative luminance (sRGB), 0–1 */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function resolveBackgroundColor(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_BACKGROUND;
  const s = raw.trim();
  const withHash = s.startsWith("#") ? s : `#${s}`;
  return hexToRgb(withHash) ? withHash : DEFAULT_BACKGROUND;
}

function isLightBackground(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.55;
}

function applySurfaceChrome(
  surfaceEl: HTMLElement,
  textEl: HTMLElement,
  backgroundColor: string,
  textEmphasis: boolean,
  backgroundOpacity: number,
): void {
  const base = resolveBackgroundColor(backgroundColor);
  const top = adjustColor(base, 10);
  const bot = adjustColor(base, -10);
  const light = isLightBackground(base);
  const o = backgroundOpacity;
  surfaceEl.style.background = `linear-gradient(180deg, ${hexToRgbaString(top, o)} 0%, ${hexToRgbaString(base, o)} 50%, ${hexToRgbaString(bot, o)} 100%)`;
  textEl.style.color = light
    ? textEmphasis
      ? "rgba(15, 23, 42, 0.58)"
      : "rgba(15, 23, 42, 0.42)"
    : textEmphasis
      ? "rgba(255, 255, 255, 0.65)"
      : "rgba(255, 255, 255, 0.5)";
}

interface RawDef {
  tx: number;
  ty: number;
  w: number;
  h: number;
  c: string;
  k: PieceKind;
}

function scatterForIndex(i: number): { x: number; y: number; r: number } {
  const presets: Array<{ x: number; y: number; r: number }> = [
    { x: 25, y: 15, r: 0.8 },
    { x: 268, y: 85, r: -1.2 },
    { x: 42, y: 88, r: 2.1 },
    { x: 230, y: 18, r: -0.5 },
    { x: 148, y: 12, r: 1.5 },
    { x: 185, y: 90, r: -2.3 },
    { x: 18, y: 52, r: 0.3 },
    { x: 260, y: 48, r: -1.8 },
    { x: 68, y: 14, r: 1.1 },
    { x: 215, y: 88, r: -0.9 },
    { x: 118, y: 92, r: 2.5 },
    { x: 255, y: 16, r: -1.5 },
    { x: 52, y: 72, r: 0.7 },
    { x: 192, y: 14, r: -2.0 },
    { x: 32, y: 38, r: 1.9 },
    { x: 245, y: 72, r: -0.4 },
    { x: 98, y: 14, r: 1.3 },
    { x: 162, y: 88, r: -1.1 },
    { x: 155, y: 25, r: 1.0 },
    { x: 175, y: 82, r: -1.4 },
    { x: 135, y: 45, r: 0.9 },
    { x: 88, y: 55, r: -0.6 },
    { x: 208, y: 55, r: 1.6 },
    { x: 112, y: 22, r: -1.0 },
    { x: 200, y: 12, r: 0.4 },
    { x: 58, y: 62, r: -1.9 },
    { x: 238, y: 68, r: 2.0 },
    { x: 278, y: 38, r: -1.3 },
    { x: 125, y: 18, r: 2.2 },
    { x: 170, y: 95, r: -2.0 },
    { x: 92, y: 96, r: 0.5 },
    { x: 82, y: 78, r: 0.6 },
    { x: 222, y: 38, r: -2.2 },
    { x: 15, y: 85, r: 1.7 },
    { x: 265, y: 28, r: -0.7 },
    { x: 140, y: 70, r: 1.4 },
    { x: 48, y: 48, r: 0.85 },
    { x: 220, y: 82, r: -1.25 },
    { x: 270, y: 62, r: 1.85 },
    { x: 38, y: 22, r: -1.95 },
    { x: 178, y: 8, r: 0.95 },
    { x: 104, y: 72, r: -2.35 },
    { x: 228, y: 96, r: 1.45 },
    { x: 72, y: 96, r: -0.55 },
    { x: 290, y: 52, r: 2.05 },
    { x: 12, y: 28, r: -1.65 },
    { x: 154, y: 96, r: 0.75 },
    { x: 198, y: 102, r: -2.15 },
    { x: 134, y: 8, r: 1.25 },
    { x: 246, y: 102, r: -0.95 },
    { x: 86, y: 8, r: 2.55 },
    { x: 36, y: 62, r: -1.05 },
    { x: 212, y: 8, r: 0.65 },
    { x: 118, y: 58, r: -2.45 },
    { x: 152, y: 82, r: 1.15 },
    { x: 76, y: 42, r: -1.75 },
    { x: 262, y: 78, r: 2.25 },
    { x: 22, y: 72, r: -0.85 },
    { x: 194, y: 72, r: 1.55 },
    { x: 108, y: 38, r: -2.05 },
    { x: 236, y: 26, r: 0.55 },
    { x: 62, y: 82, r: -1.35 },
    { x: 182, y: 38, r: 2.65 },
    { x: 44, y: 102, r: -0.45 },
    { x: 224, y: 52, r: 1.95 },
    { x: 94, y: 72, r: -2.25 },
    { x: 168, y: 18, r: 0.35 },
    { x: 286, y: 22, r: -1.85 },
    { x: 54, y: 28, r: 2.35 },
    { x: 138, y: 58, r: -1.15 },
    { x: 206, y: 92, r: 0.85 },
    { x: 26, y: 48, r: -2.55 },
    { x: 250, y: 92, r: 1.65 },
    { x: 116, y: 82, r: -0.25 },
    { x: 78, y: 62, r: 2.85 },
    { x: 160, y: 52, r: -1.55 },
    { x: 232, y: 72, r: 1.05 },
    { x: 48, y: 18, r: -2.65 },
    { x: 274, y: 92, r: 0.45 },
    { x: 98, y: 48, r: -1.45 },
    { x: 188, y: 82, r: 2.15 },
    { x: 128, y: 28, r: -0.65 },
    { x: 216, y: 22, r: 1.75 },
    { x: 58, y: 92, r: -2.85 },
    { x: 146, y: 68, r: 0.25 },
    { x: 270, y: 42, r: -2.95 },
    { x: 34, y: 82, r: 1.35 },
    { x: 106, y: 22, r: -0.75 },
    { x: 238, y: 48, r: 2.45 },
    { x: 72, y: 18, r: -1.25 },
    { x: 200, y: 62, r: 0.95 },
    { x: 254, y: 58, r: -2.35 },
    { x: 16, y: 62, r: 1.85 },
    { x: 172, y: 72, r: -1.05 },
    { x: 122, y: 48, r: 2.75 },
    { x: 92, y: 28, r: -1.95 },
    { x: 226, y: 88, r: 0.55 },
    { x: 64, y: 52, r: -2.15 },
    { x: 158, y: 28, r: 1.45 },
    { x: 244, y: 38, r: -0.35 },
    { x: 40, y: 42, r: 2.05 },
    { x: 284, y: 72, r: -1.65 },
    { x: 14, y: 42, r: 1.15 },
    { x: 136, y: 92, r: -2.75 },
    { x: 196, y: 18, r: 0.65 },
    { x: 84, y: 92, r: -1.85 },
    { x: 210, y: 42, r: 2.95 },
    { x: 52, y: 58, r: -0.95 },
    { x: 248, y: 18, r: 1.25 },
    { x: 96, y: 62, r: -2.05 },
    { x: 184, y: 58, r: 0.75 },
    { x: 28, y: 92, r: -2.55 },
    { x: 268, y: 88, r: 1.05 },
    { x: 112, y: 68, r: -1.35 },
    { x: 218, y: 58, r: 2.25 },
    { x: 76, y: 78, r: -0.55 },
    { x: 164, y: 82, r: 1.65 },
    { x: 142, y: 38, r: -2.65 },
    { x: 230, y: 42, r: 0.85 },
    { x: 60, y: 38, r: -1.75 },
    { x: 252, y: 82, r: 2.55 },
    { x: 100, y: 82, r: -1.15 },
    { x: 176, y: 42, r: 1.95 },
    { x: 130, y: 18, r: -2.85 },
    { x: 286, y: 68, r: 0.35 },
    { x: 46, y: 72, r: -1.55 },
    { x: 208, y: 28, r: 2.35 },
    { x: 118, y: 18, r: -0.45 },
    { x: 192, y: 92, r: 1.55 },
    { x: 88, y: 38, r: -2.25 },
    { x: 234, y: 62, r: 0.65 },
    { x: 68, y: 68, r: -2.95 },
    { x: 154, y: 48, r: 1.75 },
    { x: 36, y: 28, r: -1.05 },
    { x: 258, y: 42, r: 2.15 },
    { x: 104, y: 92, r: -1.85 },
    { x: 220, y: 68, r: 0.95 },
    { x: 56, y: 82, r: -2.45 },
    { x: 168, y: 62, r: 1.35 },
    { x: 148, y: 22, r: -0.85 },
    { x: 276, y: 58, r: 2.65 },
    { x: 90, y: 52, r: -1.25 },
    { x: 186, y: 28, r: 1.85 },
    { x: 124, y: 62, r: -2.55 },
    { x: 242, y: 82, r: 0.45 },
    { x: 74, y: 92, r: -1.65 },
    { x: 200, y: 82, r: 2.05 },
    { x: 46, y: 52, r: -0.75 },
    { x: 214, y: 18, r: 1.45 },
    { x: 134, y: 72, r: -2.35 },
    { x: 262, y: 32, r: 1.05 },
    { x: 82, y: 22, r: -2.15 },
    { x: 172, y: 18, r: 1.95 },
    { x: 108, y: 52, r: -1.45 },
    { x: 246, y: 68, r: 2.85 },
    { x: 62, y: 18, r: -0.95 },
    { x: 228, y: 26, r: 1.25 },
    { x: 94, y: 82, r: -2.75 },
    { x: 156, y: 92, r: 0.55 },
    { x: 38, y: 92, r: -1.35 },
    { x: 198, y: 48, r: 2.45 },
    { x: 126, y: 92, r: -1.05 },
    { x: 260, y: 72, r: 1.65 },
    { x: 70, y: 52, r: -2.65 },
    { x: 182, y: 92, r: 0.75 },
    { x: 22, y: 82, r: -1.95 },
    { x: 238, y: 92, r: 2.25 },
    { x: 140, y: 52, r: -0.65 },
    { x: 206, y: 72, r: 1.55 },
    { x: 54, y: 42, r: -2.05 },
    { x: 166, y: 38, r: 1.15 },
    { x: 114, y: 62, r: -2.85 },
    { x: 252, y: 48, r: 0.85 },
    { x: 78, y: 28, r: -1.55 },
    { x: 188, y: 72, r: 2.35 },
    { x: 96, y: 18, r: -0.35 },
    { x: 226, y: 52, r: 1.75 },
    { x: 58, y: 72, r: -2.45 },
    { x: 174, y: 82, r: 0.65 },
    { x: 132, y: 82, r: -1.85 },
    { x: 248, y: 52, r: 2.55 },
    { x: 84, y: 72, r: -1.25 },
    { x: 216, y: 92, r: 1.05 },
    { x: 44, y: 62, r: -2.95 },
    { x: 158, y: 72, r: 1.45 },
    { x: 118, y: 42, r: -0.55 },
    { x: 234, y: 22, r: 2.15 },
    { x: 66, y: 92, r: -1.75 },
    { x: 194, y: 62, r: 1.85 },
    { x: 102, y: 72, r: -2.25 },
    { x: 270, y: 82, r: 0.95 },
    { x: 30, y: 72, r: -1.15 },
    { x: 212, y: 82, r: 2.65 },
    { x: 138, y: 62, r: -2.55 },
    { x: 254, y: 38, r: 1.35 },
    { x: 76, y: 48, r: -1.65 },
    { x: 178, y: 92, r: 2.05 },
    { x: 110, y: 92, r: -0.85 },
    { x: 242, y: 58, r: 1.55 },
    { x: 48, y: 32, r: -2.35 },
    { x: 164, y: 58, r: 1.25 },
    { x: 92, y: 58, r: -2.15 },
    { x: 228, y: 82, r: 0.45 },
    { x: 56, y: 48, r: -1.95 },
    { x: 186, y: 52, r: 2.75 },
    { x: 128, y: 42, r: -1.05 },
    { x: 220, y: 38, r: 1.65 },
    { x: 72, y: 82, r: -2.85 },
    { x: 152, y: 38, r: 0.55 },
    { x: 262, y: 92, r: -1.45 },
    { x: 40, y: 78, r: 2.25 },
    { x: 196, y: 72, r: -1.35 },
    { x: 236, y: 78, r: 1.95 },
    { x: 86, y: 62, r: -2.65 },
    { x: 170, y: 48, r: 1.75 },
    { x: 146, y: 82, r: -0.75 },
    { x: 208, y: 52, r: 2.45 },
    { x: 98, y: 38, r: -1.85 },
    { x: 252, y: 72, r: 1.15 },
    { x: 34, y: 52, r: -2.05 },
    { x: 180, y: 62, r: 1.55 },
    { x: 122, y: 72, r: -2.75 },
    { x: 246, y: 48, r: 0.85 },
    { x: 64, y: 62, r: -1.25 },
    { x: 214, y: 72, r: 2.35 },
  ];
  if (i < presets.length) return presets[i];
  const t = i + 0.37;
  const x = 26 + ((t * 53.17 + Math.sin(t * 2.03) * 14) % 248);
  const y = 14 + ((t * 37.91 + Math.cos(t * 1.74) * 13) % 80);
  const r = Math.sin(t * 0.71) * 2.35 + Math.cos(t * 1.09) * 0.92;
  return { x, y, r };
}

function createBricks(color: string, baseColor: string): Brick[] {
  const lighter = adjustColor(color, 30);
  const darker = adjustColor(color, -26);
  const slightLight = adjustColor(color, 14);
  const whitePod = "#fbfcfe";
  const whiteDepth = "#e9edf4";
  const blk = "#1c1c22";
  const blkHi = "#282830";
  const tire = "#111116";
  /** Polybag taillight — matches instruction booklet translucent red stud */
  const taillight = "#ff2d20";
  const cockpit = adjustColor(baseColor, 10);

  const defs: RawDef[] = [];

  const P = (
    tx: number,
    ty: number,
    w: number,
    h: number,
    c: string,
    k: PieceKind,
  ) => defs.push({ tx, ty, w, h, c, k });

  // === CHASSIS: one large black base plate running the car's length ===
  P(68, 44, 136, 16, blk, "panel");

  // === REAR WING: thin wide plate (narrow in x, spanning car width in y) ===
  P(56, 28, 10, 48, blk, "panel");
  P(60, 30, 14, 9, color, "stud");
  P(60, 65, 14, 9, color, "stud");
  P(62, 39, 12, 26, slightLight, "panel");
  P(66, 49, 4, 6, taillight, "pin");

  // === REAR BODY: two large yellow stud bricks + center overlay ===
  P(72, 36, 42, 10, color, "stud");
  P(72, 58, 42, 10, color, "stud");
  P(78, 44, 34, 16, slightLight, "panel");

  // === MID-BODY: yellow plates continuing the taper ===
  P(112, 34, 38, 8, color, "stud");
  P(112, 62, 38, 8, color, "stud");
  P(118, 42, 30, 20, slightLight, "panel");

  // === SIDE PODS: white panels flanking the body ===
  P(112, 22, 32, 12, whitePod, "panel");
  P(112, 70, 32, 12, whitePod, "panel");
  P(116, 28, 24, 6, whiteDepth, "panel");
  P(116, 70, 24, 6, whiteDepth, "panel");

  // === COCKPIT: dark tub with black opening ===
  P(136, 44, 18, 16, cockpit, "panel");
  P(140, 48, 10, 8, blk, "stud");

  // === NOSE: tapering yellow section toward front ===
  P(148, 40, 42, 8, color, "panel");
  P(148, 56, 42, 8, color, "panel");
  P(152, 46, 36, 12, slightLight, "panel");
  P(186, 44, 24, 16, darker, "panel");
  P(192, 46, 18, 12, lighter, "stud");

  // === FRONT WING ENDPLATES ===
  P(200, 34, 14, 6, color, "stud");
  P(200, 64, 14, 6, color, "stud");

  // === ACCENT DETAILS: axle links + transition plates ===
  P(72, 48, 8, 8, blk, "panel");
  P(110, 49, 4, 6, blkHi, "axle");
  P(178, 49, 4, 6, blkHi, "axle");
  P(138, 34, 12, 4, darker, "panel");
  P(138, 66, 12, 4, darker, "panel");

  // === WHEELS: rear pair larger, assembled last ===
  P(92, 16, 14, 14, tire, "wheel");
  P(92, 74, 14, 14, tire, "wheel");
  P(182, 22, 12, 12, tire, "wheel");
  P(182, 70, 12, 12, tire, "wheel");

  return defs.map((d, i) => {
    const s = scatterForIndex(i);
    return {
      targetX: d.tx,
      targetY: d.ty,
      scatterX: s.x,
      scatterY: s.y,
      scatterRotation: s.r,
      w: d.w,
      h: d.h,
      color: d.c,
      kind: d.k,
    };
  });
}

/** Raised LEGO studs — prominent 3D cylinders matching classic brick appearance. */
function drawLegoStudLayer(
  ctx: CanvasRenderingContext2D,
  hw: number,
  hh: number,
  w: number,
  h: number,
  plateColor: string,
): void {
  const margin = 1.6;
  const uw = Math.max(1, w - margin * 2);
  const uh = Math.max(1, h - margin * 2);
  const pitch = Math.max(5.6, Math.min(8.0, Math.min(uw, uh) * 0.52));
  const cols = Math.max(1, Math.floor(uw / pitch));
  const rows = Math.max(1, Math.floor(uh / pitch));
  const stepX = uw / (cols + 1);
  const stepY = uh / (rows + 1);
  const studR = Math.min(
    2.8,
    Math.min(stepX, stepY) * 0.45,
    Math.min(w, h) * 0.22,
  );
  const dark = adjustColor(plateColor, -20);
  const hi = adjustColor(plateColor, 30);
  const mid = adjustColor(plateColor, 8);

  for (let c = 1; c <= cols; c++) {
    for (let r = 1; r <= rows; r++) {
      const sx = -hw + margin + c * stepX;
      const sy = -hh + margin + r * stepY;

      ctx.fillStyle = "rgba(0,0,0,0.09)";
      ctx.beginPath();
      ctx.arc(sx + 0.3, sy + 0.4, studR + 0.15, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(sx, sy, studR, 0, Math.PI * 2);
      ctx.fill();

      const g = ctx.createRadialGradient(
        sx - studR * 0.28,
        sy - studR * 0.28,
        0,
        sx,
        sy,
        studR * 1.05,
      );
      g.addColorStop(0, hi);
      g.addColorStop(0.4, mid);
      g.addColorStop(0.8, plateColor);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, studR * 0.86, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.52)";
      ctx.beginPath();
      ctx.arc(sx - studR * 0.26, sy - studR * 0.28, studR * 0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 0.42;
      ctx.beginPath();
      ctx.arc(sx, sy, studR * 0.88, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Rounded rectangle path (no fill/stroke). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawTechnicBeam(
  ctx: CanvasRenderingContext2D,
  hw: number,
  hh: number,
  w: number,
  h: number,
  fillColor: string,
): void {
  const bev = Math.max(0.5, Math.min(w, h) * 0.06);

  const g = ctx.createLinearGradient(-hw, -hh, hw * 0.4, hh * 0.8);
  g.addColorStop(0, adjustColor(fillColor, 14));
  g.addColorStop(0.5, fillColor);
  g.addColorStop(1, adjustColor(fillColor, -12));
  ctx.fillStyle = g;
  ctx.fillRect(-hw, -hh, w, h);

  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(-hw, -hh, w, bev);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(-hw, -hh, bev, h);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(-hw, hh - bev, w, bev);
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  ctx.fillRect(hw - bev, -hh, bev, h);

  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 0.4;
  ctx.strokeRect(-hw + 0.2, -hh + 0.2, w - 0.4, h - 0.4);

  const horizontal = w >= h;
  const shortSide = Math.min(w, h);
  const holeR = Math.max(0.72, shortSide * 0.28);
  const pitch = Math.max(holeR * 2.45, 3);
  const extent = (horizontal ? w : h) - Math.min(3.4, shortSide * 0.95);
  const count = Math.max(2, Math.min(9, Math.floor(extent / pitch)));
  const span = (count - 1) * pitch;
  const start = -span * 0.5;

  for (let i = 0; i < count; i++) {
    const ox = horizontal ? start + i * pitch : 0;
    const oy = horizontal ? 0 : start + i * pitch;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(ox + 0.15, oy + 0.18, holeR + 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a3f4a";
    ctx.beginPath();
    ctx.arc(ox, oy, holeR * 0.84, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 0.34;
    ctx.beginPath();
    ctx.arc(ox, oy, holeR * 0.98, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.26;
    ctx.beginPath();
    ctx.arc(ox, oy, holeR * 0.48, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSlickPanel(
  ctx: CanvasRenderingContext2D,
  hw: number,
  hh: number,
  w: number,
  h: number,
  fillColor: string,
): void {
  const corner = Math.min(2.8, Math.min(w, h) * 0.22);
  const bev = Math.max(0.6, Math.min(w, h) * 0.06);

  const g = ctx.createLinearGradient(-hw, -hh, hw * 0.5, hh * 0.8);
  g.addColorStop(0, adjustColor(fillColor, 16));
  g.addColorStop(0.5, fillColor);
  g.addColorStop(1, adjustColor(fillColor, -12));
  ctx.fillStyle = g;
  roundRectPath(ctx, -hw, -hh, w, h, corner);
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, -hw, -hh, w, h, corner);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(-hw, -hh, w, bev);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(-hw, -hh, bev, h);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(-hw, hh - bev, w, bev);
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  ctx.fillRect(hw - bev, -hh, bev, h);
  ctx.restore();

  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 0.45;
  roundRectPath(ctx, -hw + 0.2, -hh + 0.2, w - 0.4, h - 0.4, corner * 0.95);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 0.28;
  roundRectPath(ctx, -hw + 0.5, -hh + 0.5, w - 1, h - 1, corner * 0.9);
  ctx.stroke();
}

const TAILLIGHT_PIN = "#ff2d20";

function drawPinPiece(ctx: CanvasRenderingContext2D, fillColor: string): void {
  const pr = 1.6;
  const isTail = fillColor === TAILLIGHT_PIN;

  if (isTail) {
    const rg = ctx.createRadialGradient(-0.2, -0.22, 0.15, 0, 0, pr + 0.3);
    rg.addColorStop(0, "#ff8880");
    rg.addColorStop(0.35, "#ff3b30");
    rg.addColorStop(0.75, "#d81b1b");
    rg.addColorStop(1, "#9a1410");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.arc(-pr * 0.3, -pr * 0.32, pr * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(160,30,20,0.4)";
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, pr * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  const rg = ctx.createRadialGradient(-0.3, -0.28, 0.04, 0.06, 0.06, pr + 0.25);
  rg.addColorStop(0, adjustColor(fillColor, 28));
  rg.addColorStop(0.5, fillColor);
  rg.addColorStop(1, adjustColor(fillColor, -16));
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(0, 0, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(-pr * 0.35, -pr * 0.37, pr * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.arc(0, 0, pr, 0, Math.PI * 2);
  ctx.stroke();
}

function drawAxlePiece(
  ctx: CanvasRenderingContext2D,
  hw: number,
  hh: number,
  w: number,
  h: number,
): void {
  const corner = Math.min(h, w) * 0.42;

  const g = ctx.createLinearGradient(-hw, -hh, hw * 0.3, hh * 0.6);
  g.addColorStop(0, "#3c414c");
  g.addColorStop(0.5, "#32363f");
  g.addColorStop(1, "#282c34");
  ctx.fillStyle = g;
  roundRectPath(ctx, -hw, -hh, w, h, corner);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 0.3;
  roundRectPath(ctx, -hw + 0.25, -hh + 0.25, w - 0.5, h - 0.5, corner * 0.9);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.35;
  roundRectPath(ctx, -hw + 0.1, -hh + 0.1, w - 0.2, h - 0.2, corner * 0.95);
  ctx.stroke();
}

function drawStudBrick(
  ctx: CanvasRenderingContext2D,
  hw: number,
  hh: number,
  w: number,
  h: number,
  fillColor: string,
): void {
  const bev = Math.max(0.7, Math.min(w, h) * 0.07);

  const g = ctx.createLinearGradient(-hw, -hh, hw * 0.4, hh * 0.8);
  g.addColorStop(0, adjustColor(fillColor, 16));
  g.addColorStop(0.5, fillColor);
  g.addColorStop(1, adjustColor(fillColor, -12));
  ctx.fillStyle = g;
  ctx.fillRect(-hw, -hh, w, h);

  ctx.fillStyle = "rgba(255,255,255,0.24)";
  ctx.fillRect(-hw, -hh, w, bev);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(-hw, -hh, bev, h);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fillRect(-hw, hh - bev, w, bev);
  ctx.fillStyle = "rgba(0,0,0,0.09)";
  ctx.fillRect(hw - bev, -hh, bev, h);

  ctx.strokeStyle = "rgba(0,0,0,0.14)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(-hw + 0.25, -hh + 0.25, w - 0.5, h - 0.5);

  drawLegoStudLayer(ctx, hw, hh, w, h, fillColor);
}

function drawWheelPiece(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  glow: number,
): void {
  const r = Math.min(w, h) * 0.5;

  const tireG = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r + 1.2);
  tireG.addColorStop(0, "#1e1e24");
  tireG.addColorStop(0.6, "#111116");
  tireG.addColorStop(1, "#08080c");
  ctx.fillStyle = tireG;
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, r + 0.9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.1, 0, Math.PI * 2);
  ctx.stroke();

  const rimG = ctx.createRadialGradient(-r * 0.08, -r * 0.1, 0, 0, 0, r - 1.5);
  rimG.addColorStop(0, "#ffffff");
  rimG.addColorStop(0.6, "#f0f3f9");
  rimG.addColorStop(1, "#dde3ed");
  ctx.fillStyle = rimG;
  ctx.beginPath();
  ctx.arc(0, 0, r - 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.arc(0, 0, r - 1.8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.arc(0, 0, r - 2.1, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  const hubG = ctx.createRadialGradient(-r * 0.06, -r * 0.06, 0, 0, 0, r * 0.4);
  hubG.addColorStop(0, "#f8fafc");
  hubG.addColorStop(0.45, "#e2e8f2");
  hubG.addColorStop(1, "#b8c4d4");
  ctx.fillStyle = hubG;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.14)";
  ctx.lineWidth = 0.38;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#9aa4b4";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
  ctx.fill();

  if (glow > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.22 * glow})`;
    ctx.beginPath();
    ctx.arc(0, 0, r + 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
  fillColor: string,
  kind: PieceKind,
  glow: number = 0,
  assembleScale: number = 1,
): void {
  ctx.save();
  ctx.translate(x + w * 0.5, y + h * 0.5);
  ctx.rotate(rotation);
  ctx.scale(assembleScale, assembleScale);

  if (kind === "wheel") {
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.arc(0.6, 0.8, Math.min(w, h) * 0.5 + 1.8, 0, Math.PI * 2);
    ctx.fill();
    drawWheelPiece(ctx, w, h, glow);
    ctx.restore();
    return;
  }

  if (kind === "pin") {
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.beginPath();
    ctx.arc(0.3, 0.35, 2, 0, Math.PI * 2);
    ctx.fill();
    drawPinPiece(ctx, fillColor);
    if (glow > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * glow})`;
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const hw = w * 0.5;
  const hh = h * 0.5;
  const corner = kind === "panel" ? Math.min(2.8, Math.min(w, h) * 0.22) : 0;

  ctx.fillStyle = "rgba(0,0,0,0.08)";
  if (corner > 0) {
    roundRectPath(ctx, -hw + 0.7, -hh + 0.8, w, h, corner);
    ctx.fill();
  } else {
    ctx.fillRect(-hw + 0.7, -hh + 0.8, w, h);
  }

  switch (kind) {
    case "technic":
      drawTechnicBeam(ctx, hw, hh, w, h, fillColor);
      break;
    case "panel":
      drawSlickPanel(ctx, hw, hh, w, h, fillColor);
      break;
    case "axle":
      drawAxlePiece(ctx, hw, hh, w, h);
      break;
    default:
      drawStudBrick(ctx, hw, hh, w, h, fillColor);
      break;
  }

  if (glow > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 * glow})`;
    if (kind === "panel") {
      roundRectPath(ctx, -hw, -hh, w, h, corner);
      ctx.fill();
    } else {
      ctx.fillRect(-hw, -hh, w, h);
    }
  }

  ctx.restore();
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  backgroundColor: string,
  backgroundOpacity: number,
): void {
  const base = resolveBackgroundColor(backgroundColor);
  const top = adjustColor(base, 14);
  const mid = base;
  const bot = adjustColor(base, -14);
  const o = backgroundOpacity;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, hexToRgbaString(top, o));
  bg.addColorStop(0.5, hexToRgbaString(mid, o));
  bg.addColorStop(1, hexToRgbaString(bot, o));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Subtle scale “snap” as each piece seats onto the build (paired with ease-out-back translation). */
function assemblePopScale(t: number): number {
  if (t >= 1) return 1;
  return 0.84 + 0.16 * easeOutBack(t);
}

function clampAssembleSpeed(raw: number | undefined): number {
  const n = raw === undefined ? 1 : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(5, Math.max(0.15, n));
}

export function legoF1(
  container: HTMLElement,
  options: LegoF1Options = {}
): LegoF1Controller {
  if (typeof document === "undefined") {
    return {
      start: () => {},
      complete: () => {},
      reset: () => {},
      setScale: () => {},
      setBackgroundColor: () => {},
      setBackgroundOpacity: () => {},
      destroy: () => {},
    };
  }

  ensureStyles();

  const {
    scale = 1,
    color = "#fdd835",
    baseColor = "#1a1a1a",
    backgroundColor: backgroundColorOpt,
    backgroundOpacity: backgroundOpacityOpt,
    text = "Bricks ready\u2026",
    textInterval: textIntervalMs = 2000,
    assembleSpeed: assembleSpeedOpt,
  } = options;
  const assembleSpeed = clampAssembleSpeed(assembleSpeedOpt);
  let sceneBackground = resolveBackgroundColor(backgroundColorOpt);
  let sceneBackgroundOpacity = clampBackgroundOpacity(backgroundOpacityOpt);

  const textArr = Array.isArray(text) ? text : null;
  const middleTexts =
    textArr && textArr.length > 2 ? textArr.slice(1, -1) : null;
  const idleText = textArr ? textArr[0] : (text as string);

  const root = document.createElement("div");
  root.className = "ef-lf1-root";

  const surface = document.createElement("div");
  surface.className = "ef-lf1-surface";

  const cvs = document.createElement("canvas");
  surface.appendChild(cvs);

  const sub = document.createElement("div");
  sub.className = "ef-lf1-text";
  sub.textContent = idleText;

  root.append(surface, sub);
  container.appendChild(root);

  const ctx = cvs.getContext("2d")!;

  type Mode = "idle" | "entering" | "working" | "leaving" | "done";
  let mode: Mode = "idle";
  let animId = 0;
  let phaseStart = 0;
  let visualScale = Math.max(0.05, scale);

  const bricks = createBricks(color, baseColor);

  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    alpha: number;
    pw: number;
    ph: number;
  }
  let particles: Particle[] = [];
  let lastSpawnElapsed = 0;

  const STAGGER_SPREAD = 640 / assembleSpeed;
  const BRICK_ANIM_MS = 460 / assembleSpeed;
  const ENTER_MS = STAGGER_SPREAD + BRICK_ANIM_MS;
  const LEAVE_MS = 800;

  function refreshChrome(textEmphasis: boolean): void {
    applySurfaceChrome(
      surface,
      sub,
      sceneBackground,
      textEmphasis,
      sceneBackgroundOpacity,
    );
  }

  function drawScene(elapsed: number): void {
    ctx.clearRect(0, 0, W, H);
    drawFloor(ctx, sceneBackground, sceneBackgroundOpacity);

    if (mode === "idle") {
      for (const b of bricks) {
        drawPiece(
          ctx,
          b.scatterX,
          b.scatterY,
          b.w,
          b.h,
          b.scatterRotation,
          b.color,
          b.kind,
        );
      }
      return;
    }

    if (mode === "entering") {
      const n = bricks.length - 1 || 1;
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        const delay = (i / n) * STAGGER_SPREAD;
        const lt = Math.max(0, elapsed - delay);
        const t = Math.min(1, lt / BRICK_ANIM_MS);
        const et = easeOutBack(t);
        const pop = assemblePopScale(t);
        drawPiece(
          ctx,
          b.scatterX + (b.targetX - b.scatterX) * et,
          b.scatterY + (b.targetY - b.scatterY) * et,
          b.w,
          b.h,
          b.scatterRotation * (1 - et),
          b.color,
          b.kind,
          0,
          pop,
        );
      }
      return;
    }

    if (mode === "working") {
      const vibX = Math.sin(elapsed * 0.02) * 1.2;
      const vibY = Math.cos(elapsed * 0.025) * 0.6;
      const cycle = (elapsed / 160) % bricks.length;
      const hlIdx = Math.floor(cycle);
      const hlGlow = Math.sin((cycle - hlIdx) * Math.PI);
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        drawPiece(
          ctx,
          b.targetX + vibX,
          b.targetY + vibY,
          b.w,
          b.h,
          0,
          b.color,
          b.kind,
          i === hlIdx ? hlGlow : 0,
        );
      }
      return;
    }

    if (mode === "leaving") {
      const driveT = Math.min(1, elapsed / LEAVE_MS);
      const accel = driveT * driveT * driveT;
      const offsetX = accel * (W + 120);

      for (const b of bricks) {
        drawPiece(
          ctx,
          b.targetX + offsetX,
          b.targetY,
          b.w,
          b.h,
          0,
          b.color,
          b.kind,
        );
      }

      if (elapsed < 100) {
        const flash = 0.045 * (1 - elapsed / 100);
        ctx.fillStyle = isLightBackground(sceneBackground)
          ? `rgba(15,23,42,${flash})`
          : `rgba(255,255,255,${flash * 1.1})`;
        ctx.fillRect(0, 0, W, H);
      }

      for (const p of particles) {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = color;
        ctx.fillRect(p.x, p.y, p.pw, p.ph);
      }
      ctx.globalAlpha = 1;
    }
  }

  function renderIdle(): void {
    particles = [];
    lastSpawnElapsed = 0;
    ctx.clearRect(0, 0, W, H);
    drawFloor(ctx, sceneBackground, sceneBackgroundOpacity);
    for (const b of bricks) {
      drawPiece(
        ctx,
        b.scatterX,
        b.scatterY,
        b.w,
        b.h,
        b.scatterRotation,
        b.color,
        b.kind,
      );
    }
  }

  function applyPixelScale(s: number): void {
    visualScale = Math.max(0.05, s);
    const dpr = window.devicePixelRatio || 1;
    surface.style.width = `${W * visualScale}px`;
    surface.style.height = `${H * visualScale}px`;
    sub.style.maxWidth = `${W * visualScale}px`;
    cvs.width = Math.max(1, Math.round(W * dpr * visualScale));
    cvs.height = Math.max(1, Math.round(H * dpr * visualScale));
    ctx.setTransform(dpr * visualScale, 0, 0, dpr * visualScale, 0, 0);
    if (mode === "idle") renderIdle();
    else drawScene(0);
  }

  applyPixelScale(scale);
  refreshChrome(false);

  function enterLoop(now: number): void {
    if (mode !== "entering") return;
    if (!phaseStart) phaseStart = now;
    const elapsed = now - phaseStart;

    drawScene(elapsed);

    if (elapsed < ENTER_MS) {
      animId = requestAnimationFrame(enterLoop);
    } else {
      mode = "working";
      phaseStart = 0;
      animId = requestAnimationFrame(workLoop);
    }
  }

  function workLoop(now: number): void {
    if (mode !== "working") return;
    if (!phaseStart) phaseStart = now;
    const elapsed = now - phaseStart;

    if (middleTexts) {
      const idx = Math.floor(elapsed / textIntervalMs) % middleTexts.length;
      sub.textContent = middleTexts[idx];
    }

    drawScene(elapsed);
    animId = requestAnimationFrame(workLoop);
  }

  function leaveLoop(now: number): void {
    if (mode !== "leaving") return;
    if (!phaseStart) phaseStart = now;
    const elapsed = now - phaseStart;

    // Spawn trail particles
    if (elapsed > 100 && elapsed < 650 && elapsed - lastSpawnElapsed > 70) {
      lastSpawnElapsed = elapsed;
      const driveT = Math.min(1, elapsed / LEAVE_MS);
      const offsetX = (driveT * driveT * driveT) * (W + 120);
      particles.push({
        x: 86 + offsetX,
        y: 55 + (Math.random() - 0.5) * 26,
        vx: -(1.2 + Math.random() * 2),
        vy: (Math.random() - 0.5) * 0.8,
        alpha: 0.55,
        pw: 2 + Math.random() * 3,
        ph: 1.5 + Math.random() * 2,
      });
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.018;
      if (p.alpha <= 0) particles.splice(i, 1);
    }

    drawScene(elapsed);

    if (elapsed < LEAVE_MS) {
      animId = requestAnimationFrame(leaveLoop);
    } else {
      mode = "done";
      ctx.clearRect(0, 0, W, H);
      drawFloor(ctx, sceneBackground, sceneBackgroundOpacity);
      sub.textContent = textArr
        ? textArr[textArr.length - 1]
        : "Built \u2014 launching!";
      refreshChrome(true);
    }
  }

  function start(): void {
    cancelAnimationFrame(animId);
    mode = "entering";
    phaseStart = 0;
    particles = [];
    lastSpawnElapsed = 0;
    sub.textContent = textArr ? textArr[0] : "Bricks assembling\u2026";
    refreshChrome(false);
    animId = requestAnimationFrame(enterLoop);
  }

  function complete(): void {
    if (mode !== "working") return;
    cancelAnimationFrame(animId);
    mode = "leaving";
    phaseStart = 0;
    particles = [];
    lastSpawnElapsed = 0;
    sub.textContent = textArr
      ? textArr[textArr.length - 1]
      : "Built \u2014 launching!";
    refreshChrome(true);
    animId = requestAnimationFrame(leaveLoop);
  }

  function reset(): void {
    cancelAnimationFrame(animId);
    mode = "idle";
    sub.textContent = idleText;
    refreshChrome(false);
    renderIdle();
  }

  function setScale(next: number): void {
    const s = Number.isFinite(next) && next > 0 ? next : 1;
    applyPixelScale(s);
  }

  function setBackgroundColor(hex: string): void {
    sceneBackground = resolveBackgroundColor(hex);
    refreshChrome(mode === "done");
    if (mode === "idle") renderIdle();
    else if (mode === "done") {
      ctx.clearRect(0, 0, W, H);
      drawFloor(ctx, sceneBackground, sceneBackgroundOpacity);
    }
  }

  function setBackgroundOpacity(opacity: number): void {
    sceneBackgroundOpacity = clampBackgroundOpacity(opacity);
    refreshChrome(mode === "done");
    if (mode === "idle") renderIdle();
    else if (mode === "done") {
      ctx.clearRect(0, 0, W, H);
      drawFloor(ctx, sceneBackground, sceneBackgroundOpacity);
    }
  }

  function destroy(): void {
    cancelAnimationFrame(animId);
    mode = "idle";
    root.remove();
  }

  return {
    start,
    complete,
    reset,
    setScale,
    setBackgroundColor,
    setBackgroundOpacity,
    destroy,
  };
}

export default legoF1;
