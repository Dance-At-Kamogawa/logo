/**
 * Flattens ../svg/dak_logo.svg (Inkscape export with nested group transforms
 * and <symbol>/<use> glyphs) into a single 1000x1000 coordinate system and
 * writes typed geometry to src/logo/geometry.generated.ts.
 *
 * Usage: pnpm extract
 *
 * The original viewBox (0 0 83.836693 83.8367, in mm) is mapped onto
 * 0 0 1000 1000, so the generated geometry overlays the original 1:1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import svgpath from "svgpath";
import { parse, type INode } from "svgson";

type Matrix = [number, number, number, number, number, number];

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../../svg/dak_logo.svg");
const TARGET = resolve(here, "../src/logo/geometry.generated.ts");
const VIEWBOX_OUT = 1000;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const parseTransform = (value: string | undefined): Matrix => {
  if (!value) return IDENTITY;
  let result = IDENTITY;
  const re = /(matrix|translate|scale)\s*\(([^)]*)\)/g;
  for (const match of value.matchAll(re)) {
    const nums = (match[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let m: Matrix;
    switch (match[1]) {
      case "matrix":
        m = [nums[0] ?? 1, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1, nums[4] ?? 0, nums[5] ?? 0];
        break;
      case "translate":
        m = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0];
        break;
      case "scale":
        m = [nums[0] ?? 1, 0, 0, nums[1] ?? nums[0] ?? 1, 0, 0];
        break;
      default:
        throw new Error(`Unsupported transform ${match[1]}`);
    }
    result = multiply(result, m);
  }
  return result;
};

const styleValue = (style: string | undefined, key: string): string | undefined => {
  if (!style) return undefined;
  for (const decl of style.split(";")) {
    const [k, v] = decl.split(":");
    if (k?.trim() === key) return v?.trim();
  }
  return undefined;
};

type Box = { x: number; y: number; width: number; height: number };

const bboxOf = (d: string): Box => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  svgpath(d)
    .abs()
    .unshort()
    .iterate((segment) => {
      // After abs() every segment lists absolute x/y pairs (H/V excepted).
      const cmd = segment[0];
      const args = segment.slice(1).map(Number);
      if (cmd === "H") {
        minX = Math.min(minX, args[0] ?? minX);
        maxX = Math.max(maxX, args[0] ?? maxX);
        return;
      }
      if (cmd === "V") {
        minY = Math.min(minY, args[0] ?? minY);
        maxY = Math.max(maxY, args[0] ?? maxY);
        return;
      }
      for (let i = 0; i + 1 < args.length; i += 2) {
        const px = args[i] ?? 0;
        const py = args[i + 1] ?? 0;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
    });
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

type Collected = {
  id: string;
  kind: "fill" | "stroke";
  d: string;
  strokeWidth: number;
  /** For glyph uses: the referenced symbol id. */
  symbol?: string;
};

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

const main = async (): Promise<void> => {
  const root = await parse(readFileSync(SOURCE, "utf8"));
  const vb = (root.attributes.viewBox ?? "").split(/\s+/).map(Number);
  const vbWidth = vb[2];
  if (!vbWidth) throw new Error("Missing viewBox");
  const k = VIEWBOX_OUT / vbWidth;
  const rootMatrix: Matrix = [k, 0, 0, k, -(vb[0] ?? 0) * k, -(vb[1] ?? 0) * k];

  const symbols = new Map<string, INode>();
  const indexSymbols = (node: INode): void => {
    if (node.name === "symbol" && node.attributes.id) symbols.set(node.attributes.id, node);
    node.children.forEach(indexSymbols);
  };
  indexSymbols(root);

  const out: Collected[] = [];
  const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

  const emitPath = (node: INode, m: Matrix, id: string, symbol?: string): void => {
    const d = node.attributes.d;
    if (!d || !d.trim()) return;
    const style = node.attributes.style;
    const stroke = styleValue(style, "stroke");
    const transformed = svgpath(d).matrix(m).round(3).toString();
    if (stroke && stroke !== "none") {
      const sw = Number(styleValue(style, "stroke-width") ?? "1");
      out.push({ id, kind: "stroke", d: transformed, strokeWidth: r3(sw * scaleOf(m)), symbol });
    } else {
      out.push({ id, kind: "fill", d: transformed, strokeWidth: 0, symbol });
    }
  };

  const walk = (node: INode, parent: Matrix): void => {
    if (node.name === "defs" || node.name === "metadata" || node.name.startsWith("sodipodi")) return;
    const m = multiply(parent, parseTransform(node.attributes.transform));
    if (node.name === "path") {
      emitPath(node, m, node.attributes.id ?? "path");
      return;
    }
    if (node.name === "use") {
      const href = (node.attributes["xlink:href"] ?? node.attributes.href ?? "").replace(/^#/, "");
      const symbol = symbols.get(href);
      if (!symbol) throw new Error(`Unknown symbol ${href}`);
      const um = multiply(m, [1, 0, 0, 1, Number(node.attributes.x ?? 0), Number(node.attributes.y ?? 0)]);
      for (const child of symbol.children) {
        if (child.name === "path") emitPath(child, um, node.attributes.id ?? href, href);
      }
      return;
    }
    node.children.forEach((c) => walk(c, m));
  };
  walk(root, rootMatrix);

  // --- classify -----------------------------------------------------------
  const frame = out.find((c) => c.id === "path884");
  if (!frame) throw new Error("frame path884 not found");
  const frameBox = bboxOf(frame.d);

  const pegIds = ["path890", "path892", "path886", "path888"]; // TL, TR, BR, BL (sorted below)
  const pegs = pegIds.map((id) => {
    const p = out.find((c) => c.id === id);
    if (!p) throw new Error(`peg ${id} not found`);
    const b = bboxOf(p.d);
    return {
      id,
      cx: r3(b.x + b.width / 2),
      cy: r3(b.y + b.height / 2),
      r: r3((b.width + b.height) / 4),
      strokeWidth: p.strokeWidth,
      d: p.d,
    };
  });
  const corner = (p: { cx: number; cy: number }): number => (p.cy < 500 ? 0 : 2) + (p.cx < 500 ? 0 : 1);
  const order = ["tl", "tr", "bl", "br"] as const;
  const namedPegs = pegs
    .map((p) => ({ ...p, corner: order[corner(p)] ?? "tl" }))
    .sort((a, b) => corner(a) - corner(b));

  // Kamogawa: glyph0-* uses, in document (= reading) order.
  const kamoChars = "Kamogawa".split("");
  const kamo = out.filter((c) => c.symbol?.startsWith("glyph0-"));
  if (kamo.length !== kamoChars.length) throw new Error(`Expected 8 Kamogawa glyphs, got ${kamo.length}`);

  // Dance at: glyph1-* fill + the stroked outline path that follows each use
  // (path930..path970 are the same letter outlines, stroked to embolden the
  // thin weight). Pair each stroke with the fill whose bbox it overlaps.
  const danceFills = out.filter((c) => c.symbol?.startsWith("glyph1-"));
  const danceStrokes = out.filter((c) => /^path9[3-7]\d$/.test(c.id) && c.kind === "stroke");
  const danceChars = "Danceat".split("");
  if (danceFills.length !== 7 || danceStrokes.length !== 7) {
    throw new Error(`Expected 7 Dance-at fills/strokes, got ${danceFills.length}/${danceStrokes.length}`);
  }
  const dance = danceFills.map((f, i) => {
    const fb = bboxOf(f.d);
    const cx = fb.x + fb.width / 2;
    const stroke = danceStrokes.reduce((best, s) => {
      const sb = bboxOf(s.d);
      const bb = bboxOf(best.d);
      return Math.abs(sb.x + sb.width / 2 - cx) < Math.abs(bb.x + bb.width / 2 - cx) ? s : best;
    });
    const sb = bboxOf(stroke.d);
    const x0 = Math.min(fb.x, sb.x);
    const y0 = Math.min(fb.y, sb.y);
    const box = {
      x: x0,
      y: y0,
      width: Math.max(fb.x + fb.width, sb.x + sb.width) - x0,
      height: Math.max(fb.y + fb.height, sb.y + sb.height) - y0,
    };
    return { char: danceChars[i] ?? "?", fill: f.d, stroke: stroke.d, strokeWidth: stroke.strokeWidth, box };
  });

  const boxLiteral = (b: Box): string =>
    `{ x: ${r3(b.x)}, y: ${r3(b.y)}, width: ${r3(b.width)}, height: ${r3(b.height)} }`;

  const lines: string[] = [];
  lines.push("// AUTO-GENERATED by scripts/extract-logo.ts from svg/dak_logo.svg. Do not edit by hand.");
  lines.push("// Coordinate system: 0 0 1000 1000 (original 83.84mm viewBox scaled 1:1).");
  lines.push("");
  lines.push('import type { Box, DanceGlyphData, KamoGlyphData, PegData } from "./types";');
  lines.push("");
  lines.push(`export const LOGO_VIEWBOX = ${VIEWBOX_OUT} as const;`);
  lines.push("");
  lines.push("export const FRAME = {");
  lines.push(`  d: ${JSON.stringify(frame.d)},`);
  lines.push(`  box: ${boxLiteral(frameBox)} satisfies Box,`);
  lines.push(`  strokeWidth: ${frame.strokeWidth},`);
  lines.push("} as const;");
  lines.push("");
  lines.push("/** Grommet rings, ordered tl, tr, bl, br. */");
  lines.push("export const PEGS: readonly PegData[] = [");
  for (const p of namedPegs) {
    lines.push(
      `  { id: ${JSON.stringify(p.id)}, corner: ${JSON.stringify(p.corner)}, cx: ${p.cx}, cy: ${p.cy}, r: ${p.r}, strokeWidth: ${p.strokeWidth}, d: ${JSON.stringify(p.d)} },`,
    );
  }
  lines.push("];");
  lines.push("");
  lines.push("/** Thin 'Dance at' letters: fill outline + stroked outline (emboldening). */");
  lines.push("export const DANCE_GLYPHS: readonly DanceGlyphData[] = [");
  for (const g of dance) {
    lines.push(
      `  { char: ${JSON.stringify(g.char)}, fill: ${JSON.stringify(g.fill)}, stroke: ${JSON.stringify(g.stroke)}, strokeWidth: ${g.strokeWidth}, box: ${boxLiteral(g.box)} },`,
    );
  }
  lines.push("];");
  lines.push("");
  lines.push("/** Bold 'Kamogawa' letters. */");
  lines.push("export const KAMO_GLYPHS: readonly KamoGlyphData[] = [");
  kamo.forEach((g, i) => {
    lines.push(
      `  { char: ${JSON.stringify(kamoChars[i])}, d: ${JSON.stringify(g.d)}, box: ${boxLiteral(bboxOf(g.d))} },`,
    );
  });
  lines.push("];");
  lines.push("");

  writeFileSync(TARGET, lines.join("\n"));
  console.log(`Wrote ${TARGET}`);
  console.log("frame", frameBox, "pegs", namedPegs.map((p) => [p.corner, p.cx, p.cy, p.r]));
  console.log("dance", dance.map((g) => [g.char, r3(g.box.x), r3(g.box.y)]));
  console.log("kamo", kamo.map((g, i) => [kamoChars[i], boxLiteral(bboxOf(g.d))]));
};

await main();
