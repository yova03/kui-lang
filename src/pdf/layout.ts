import { existsSync } from "node:fs";
import path from "node:path";
import type { BlockNode, HeadingNode, InlineNode } from "../core/ast.js";
import { resolveCachedAssetPath } from "../semantic/assets.js";
import { resolveAssetPath } from "../utils/asset-resolver.js";
import type { LabelInfo, HeadingInfo, NativePdfContext } from "./types.js";
import { FONT_DIR, ICONS } from "./fonts.js";
import { inlineText, safePdfText } from "./inline.js";
import { isFichaRegistroBlock } from "./toc.js";

export function usesProfessionalBodyStyle(templateId: string): boolean {
  return templateId === "informe-operativo" || templateId === "carta-institucional";
}

export function formatExpedienteLabel(expediente: string): string {
  const normalized = expediente.trim();
  if (!normalized) return "";
  const startsWithNumberMarker = /^N(?:\.?\s*[\u00B0\u00BA]|o\.?|ro\.?)\s*/i.test(normalized);
  return startsWithNumberMarker ? `Exp. ${normalized}` : `Exp. N.\u00B0 ${normalized}`;
}

export function renderIcon(ctx: NativePdfContext, name: string, size: number, color: string, x: number, y: number): void {
  const glyph = ICONS[name];
  if (!glyph) return;
  if (!existsSync(path.join(FONT_DIR, "material-icons/MaterialIcons-Regular.ttf"))) return;
  ctx.doc.font("KUI-Icons").fontSize(size).fillColor(color).text(glyph, x, y, { lineBreak: false });
}

export function drawLinearGradient(
  ctx: NativePdfContext,
  x: number,
  y: number,
  width: number,
  height: number,
  from: string,
  to: string,
  radius = 0
): void {
  const gradient = ctx.doc.linearGradient(x, y, x + width, y + height);
  gradient.stop(0, from);
  gradient.stop(0.54, blendHex(from, to, 0.42));
  gradient.stop(1, to);
  if (radius > 0) ctx.doc.roundedRect(x, y, width, height, radius).fill(gradient);
  else ctx.doc.rect(x, y, width, height).fill(gradient);
}

export function drawSoftCircle(ctx: NativePdfContext, centerX: number, centerY: number, diameter: number, color: string, opacity: number): void {
  ctx.doc.save().fillOpacity(opacity).circle(centerX, centerY, diameter / 2).fill(color).restore();
}

export function resolvePdfColor(value: string | undefined, ctx: NativePdfContext, fallback: string): string {
  if (!value) return fallback;
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return value;
  const colors = ctx.template.defaultStyle.colors;
  const named: Record<string, string> = {
    red: "#DC2626",
    blue: "#2563EB",
    green: "#16A34A",
    yellow: "#FACC15",
    gray: "#64748B",
    black: "#111827",
    white: "#FFFFFF",
    orange: "#EA580C",
    purple: "#7C3AED",
    pink: "#DB2777",
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    muted: colors.muted,
    text: colors.text
  };
  return named[value.toLowerCase()] ?? fallback;
}

function blendHex(from: string, to: string, ratio: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;
  const mix = (start: number, end: number) => Math.round(start + (end - start) * ratio);
  return rgbToHex(mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b));
}

function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return undefined;
  const raw = match[1];
  const hex = raw.length === 3 ? [...raw].map((char) => `${char}${char}`).join("") : raw;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function formatNumber(value: number, decimals = value >= 100 ? 0 : 2): string {
  return value.toLocaleString("es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function drawRule(ctx: NativePdfContext): void {
  const x = ctx.doc.x;
  const y = ctx.doc.y;
  ctx.doc.moveTo(x, y).lineTo(ctx.doc.page.width - ctx.doc.page.margins.right, y).stroke("#AAAAAA");
  ctx.doc.moveDown(1);
}

export function authorText(author: unknown): string {
  if (Array.isArray(author)) {
    return author.map((item) => typeof item === "string" ? item : String((item as Record<string, unknown>).name ?? "")).join(", ");
  }
  return typeof author === "string" ? author : "";
}

export function frontmatterText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(frontmatterText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return safePdfText(String(record.value ?? record.name ?? record.label ?? ""));
  }
  return safePdfText(String(value));
}

export function frontmatterPairs(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const label = frontmatterText(record.label);
    const text = frontmatterText(record.value);
    return label || text ? [{ label, value: text }] : [];
  });
}

export function frontmatterList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(frontmatterText).filter(Boolean);
  const text = frontmatterText(value);
  return text ? [text] : [];
}

export function currentPageIndex(ctx: NativePdfContext): number {
  const range = ctx.doc.bufferedPageRange();
  return range.start + range.count - 1;
}

export function currentPageNumber(ctx: NativePdfContext): number {
  return currentPageIndex(ctx) + 1;
}

export function headingDestination(index: number, heading?: HeadingInfo): string {
  return pdfDestinationName(`heading-${index + 1}-${heading?.id ?? heading?.title ?? "section"}`);
}

export function labelDestination(id: string): string {
  return pdfDestinationName(`label-${id}`);
}

function pdfDestinationName(value: string): string {
  return `kui-${value}`.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

export function registerPdfDestination(ctx: NativePdfContext, destination: string | undefined): void {
  if (!destination || ctx.registeredDestinations.has(destination)) return;
  ctx.doc.addNamedDestination(destination, "XYZ", ctx.doc.page.margins.left, ctx.doc.y, null);
  ctx.registeredDestinations.add(destination);
}

export function addInternalLink(ctx: NativePdfContext, x: number, y: number, width: number, height: number, destination: string): void {
  ctx.doc.goTo(x, y, Math.max(1, width), Math.max(1, height), destination);
}

export function markLabelPage(ctx: NativePdfContext, id: string | undefined): void {
  if (!id) return;
  const info = ctx.labels.get(id);
  if (info) info.page = currentPageNumber(ctx);
  registerPdfDestination(ctx, labelDestination(id));
}

export function markHeadingPage(ctx: NativePdfContext, block: HeadingNode, includeInToc = true): void {
  markLabelPage(ctx, block.attrs?.id);
  if (!includeInToc) return;
  const heading = ctx.headings[ctx.headingRenderIndex];
  const page = currentPageNumber(ctx);
  if (heading) heading.page = page;
  ctx.headingRenderIndex += 1;
}

export function collectLabels(blocks: BlockNode[]): Map<string, LabelInfo> {
  const labels = new Map<string, LabelInfo>();
  const counters = { sec: [0, 0, 0, 0, 0, 0], fig: 0, tbl: 0, eq: 0, thm: 0, def: 0, lem: 0, cor: 0 };
  const visit = (block: BlockNode): void => {
    if (isFichaRegistroBlock(block)) return;
    if (block.kind === "Heading") {
      const level = block.attrs?.classes.includes("chapter") ? 1 : block.level;
      counters.sec[level - 1] += 1;
      for (let index = level; index < counters.sec.length; index++) counters.sec[index] = 0;
      if (block.attrs?.id) {
        labels.set(block.attrs.id, {
          type: "sec",
          number: counters.sec.slice(0, level).filter(Boolean).join("."),
          title: inlineText(block.title)
        });
      }
    }
    if (block.kind === "Figure") {
      counters.fig += 1;
      if (block.attrs?.id) labels.set(block.attrs.id, { type: "fig", number: String(counters.fig) });
    }
    if (block.kind === "Table") {
      const title = inlineText(block.caption ?? []).trim();
      if (title) {
        counters.tbl += 1;
        if (block.attrs?.id) labels.set(block.attrs.id, { type: "tbl", number: String(counters.tbl) });
      }
    }
    if (block.kind === "MathBlock") {
      counters.eq += 1;
      if (block.attrs?.id) labels.set(block.attrs.id, { type: "eq", number: String(counters.eq) });
    }
    if (block.kind === "FencedDiv") {
      const name = block.canonicalName ?? block.name;
      if (block.attrs?.id && name === "theorem") labels.set(block.attrs.id, { type: "thm", number: String(++counters.thm) });
      if (block.attrs?.id && name === "definition") labels.set(block.attrs.id, { type: "def", number: String(++counters.def) });
      if (block.attrs?.id && name === "lemma") labels.set(block.attrs.id, { type: "thm", number: String(++counters.lem) });
      if (block.attrs?.id && name === "corollary") labels.set(block.attrs.id, { type: "thm", number: String(++counters.cor) });
      block.children.forEach(visit);
    }
    if (block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return labels;
}

export function collectFootnotes(blocks: BlockNode[], ctx?: NativePdfContext): Map<string, string> {
  const footnotes = new Map<string, string>();
  const visit = (block: BlockNode): void => {
    if (block.kind === "FootnoteDef") footnotes.set(block.id, inlineText(block.children, ctx));
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return footnotes;
}

export function collectCitationOrder(blocks: BlockNode[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const visitInline = (node: InlineNode): void => {
    if (node.kind === "Citation") {
      for (const item of node.items) {
        if (!numbers.has(item.key)) numbers.set(item.key, numbers.size + 1);
      }
      return;
    }
    if (node.kind === "Bold" || node.kind === "Italic" || node.kind === "Link" || node.kind === "Span") {
      node.children.forEach(visitInline);
    }
  };
  const visit = (block: BlockNode): void => {
    switch (block.kind) {
      case "Heading":
        block.title.forEach(visitInline);
        break;
      case "Paragraph":
      case "FootnoteDef":
        block.children.forEach(visitInline);
        break;
      case "List":
        for (const item of block.items) item.children.forEach(visitInline);
        break;
      case "Figure":
        block.caption.forEach(visitInline);
        break;
      case "Table":
        for (const row of [block.headers, ...block.rows]) {
          for (const cell of row) cell.forEach(visitInline);
        }
        block.caption?.forEach(visitInline);
        break;
      case "FencedDiv":
      case "Blockquote":
      case "Callout":
        block.children.forEach(visit);
        break;
      default:
        break;
    }
  };
  blocks.forEach(visit);
  return numbers;
}

export function ensureSpace(ctx: NativePdfContext, needed: number): void {
  const bottom = ctx.doc.page.height - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx);
  if (ctx.doc.y + needed > bottom) ctx.doc.addPage();
}

export function hasSpace(ctx: NativePdfContext, needed: number): boolean {
  return ctx.doc.y + needed <= ctx.doc.page.height - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx);
}

export function availableContentHeight(ctx: NativePdfContext): number {
  return ctx.doc.page.height - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx) - ctx.doc.y;
}

export function contentWidth(ctx: NativePdfContext): number {
  return ctx.doc.page.width - ctx.doc.page.margins.left - ctx.doc.page.margins.right;
}

export function reservedFootnoteHeight(ctx: NativePdfContext): number {
  return ctx.pageFootnoteReserves.get(currentPageIndex(ctx)) ?? 0;
}

export function resolveNodePath(rawPath: string, node: { position?: { file?: string } }, ctx: NativePdfContext): string {
  if (/^https?:\/\//i.test(rawPath)) return resolveCachedAssetPath(rawPath, ctx.options.outputDir) ?? rawPath;
  return resolveAssetPath(rawPath, { cwd: ctx.options.cwd, sourceFile: node.position?.file });
}
