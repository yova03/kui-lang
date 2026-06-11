import type { BlockNode, CitationNode, CrossRefNode, FootnoteRefNode, InlineNode } from "../core/ast.js";
import { type KuiReferenceEntry } from "../semantic/bibliography.js";
import type { NativePdfContext, FontRole, InlineSegment, InlineStyle } from "./types.js";
import { fontName } from "./fonts.js";
import { resolvePdfColor } from "./layout.js";

export function inlineText(nodes: InlineNode[], ctx?: NativePdfContext): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case "Text":
        return safePdfText(node.value);
      case "Bold":
      case "Italic":
      case "Link":
      case "Span":
        return inlineText(node.children, ctx);
      case "InlineCode":
        return safePdfText(node.value);
      case "ImageInline":
        return safePdfText(node.alt);
      case "MathInline":
        return formatMath(node.content);
      case "Citation":
        return citationText(node, ctx);
      case "CrossRef":
        return refText(node, ctx);
      case "FootnoteRef":
        return footnoteMarker(node, ctx);
    }
  }).join("");
}

function captureInlineText(nodes: InlineNode[], ctx: NativePdfContext): string {
  ctx.currentInlineFootnotes = [];
  return inlineText(nodes, ctx);
}

export function captureInlineSegments(nodes: InlineNode[], ctx: NativePdfContext, style: InlineStyle): InlineSegment[] {
  ctx.currentInlineFootnotes = [];
  return mergeInlineSegments(inlineSegments(nodes, ctx, style));
}

export function consumeInlineFootnotes(ctx: NativePdfContext): string[] {
  const refs = [...new Set(ctx.currentInlineFootnotes)];
  ctx.currentInlineFootnotes = [];
  return refs;
}

function inlineSegments(nodes: InlineNode[], ctx: NativePdfContext, style: InlineStyle): InlineSegment[] {
  return nodes.flatMap((node) => inlineSegment(node, ctx, style));
}

function inlineSegment(node: InlineNode, ctx: NativePdfContext, style: InlineStyle): InlineSegment[] {
  switch (node.kind) {
    case "Text":
      return [{ text: safePdfText(node.value), ...style }];
    case "Bold":
      return inlineSegments(node.children, ctx, { ...style, role: boldRole(style.role) });
    case "Italic":
      return inlineSegments(node.children, ctx, { ...style, role: italicRole(style.role) });
    case "InlineCode":
      return [{ text: safePdfText(node.value), role: "mono", color: "#111827" }];
    case "Link":
      return inlineSegments(node.children, ctx, { ...style, color: ctx.template.defaultStyle.colors.primary });
    case "ImageInline":
      return [{ text: safePdfText(node.alt), ...style }];
    case "Span":
      return inlineSegments(node.children, ctx, spanStyle(node, ctx, style));
    case "MathInline":
      return [{ text: formatMath(node.content), role: "serifItalic", color: style.color }];
    case "Citation":
      return [{ text: citationText(node, ctx), ...style }];
    case "CrossRef":
      return [{ text: refText(node, ctx), ...style }];
    case "FootnoteRef":
      return [{ text: footnoteMarker(node, ctx), ...style }];
  }
}

function spanStyle(node: InlineNode & { attrs?: { normalized?: Record<string, string> } }, ctx: NativePdfContext, base: InlineStyle): InlineStyle {
  const normalized = node.attrs?.normalized ?? {};
  let role = base.role;
  if (normalized.weight === "bold") role = boldRole(role);
  if (normalized.style === "italic" || normalized.style === "slanted") role = italicRole(role);
  return {
    role,
    color: resolvePdfColor(normalized.color, ctx, base.color)
  };
}

function boldRole(role: FontRole): FontRole {
  if (role === "italic" || role === "boldItalic") return "boldItalic";
  if (role === "serif" || role === "serifItalic" || role === "serifBold") return "serifBold";
  if (role === "mono") return "mono";
  return "bold";
}

function italicRole(role: FontRole): FontRole {
  if (role === "bold" || role === "boldItalic") return "boldItalic";
  if (role === "serif" || role === "serifBold" || role === "serifItalic") return "serifItalic";
  if (role === "mono") return "mono";
  return "italic";
}

function mergeInlineSegments(segments: InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const previous = merged.at(-1);
    if (previous && previous.role === segment.role && previous.color === segment.color) {
      previous.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

export function segmentText(segments: InlineSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

export function renderInlineSegments(
  segments: InlineSegment[],
  ctx: NativePdfContext,
  options: { fontSize: number; color: string; width: number; align?: "left" | "center" | "right" | "justify"; indent?: number; lineGap?: number }
): void {
  const drawable = preserveBoundarySpaces(segments).filter((segment) => segment.text.length > 0);
  if (drawable.length === 0) return;
  drawable.forEach((segment, index) => {
    ctx.doc.font(fontName(ctx, segment.role)).fontSize(options.fontSize).fillColor(segment.color || options.color);
    ctx.doc.text(segment.text, index === 0 ? {
      width: options.width,
      align: options.align,
      indent: options.indent,
      lineGap: options.lineGap,
      continued: index < drawable.length - 1
    } : {
      continued: index < drawable.length - 1
    });
  });
  ctx.doc.fillColor(options.color);
}

function preserveBoundarySpaces(segments: InlineSegment[]): InlineSegment[] {
  const normalized = segments.map((segment) => ({ ...segment }));
  for (let index = 1; index < normalized.length; index++) {
    const leading = normalized[index].text.match(/^\s+/)?.[0];
    if (!leading) continue;
    normalized[index - 1].text += leading;
    normalized[index].text = normalized[index].text.slice(leading.length);
  }
  return normalized;
}

export function blockText(block: BlockNode, ctx?: NativePdfContext): string {
  switch (block.kind) {
    case "Heading":
      return inlineText(block.title, ctx);
    case "Paragraph":
    case "FootnoteDef":
      return inlineText(block.children, ctx);
    case "List":
      return block.items.map((item) => `- ${inlineText(item.children, ctx)}`).join("\n");
    case "MathBlock":
      return formatMath(block.content);
    case "Figure":
      return inlineText(block.caption, ctx);
    case "Table":
      return [block.headers, ...block.rows].map((row) => row.map((cell) => inlineText(cell, ctx)).join(" | ")).join("\n");
    case "FencedDiv":
    case "Blockquote":
    case "Callout":
      return block.children.map((child) => blockText(child, ctx)).join("\n\n");
    case "CodeBlock":
      return block.content;
    case "Directive":
    case "HorizontalRule":
      return "";
  }
}

function citationText(node: CitationNode, ctx?: NativePdfContext): string {
  if (node.citationStyle === "intext" && node.items.length === 1) {
    const item = node.items[0];
    const entry = ctx?.references.get(item.key);
    const author = citationAuthorText(entry, "narrative") || item.key;
    const year = citationYear(entry);
    const locator = citationLocator(item.locator);
    return `${author} (${[year, locator].filter(Boolean).join(", ")})`;
  }
  const items = node.items.map((item) => parentheticalCitationItem(item, ctx));
  return `(${items.join("; ")})`;
}

function parentheticalCitationItem(item: CitationNode["items"][number], ctx?: NativePdfContext): string {
  const entry = ctx?.references.get(item.key);
  const author = citationAuthorText(entry, "parenthetical");
  const year = citationYear(entry);
  const locator = citationLocator(item.locator);
  if (!author && !entry) return [item.key, locator].filter(Boolean).join(", ");
  return [author || item.key, year, locator].filter(Boolean).join(", ");
}

function citationAuthorText(entry: KuiReferenceEntry | undefined, mode: "narrative" | "parenthetical"): string {
  const authors = entry?.author.map(citationAuthorName).filter(Boolean) ?? [];
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} ${mode === "parenthetical" ? "&" : "y"} ${authors[1]}`;
  return `${authors[0]} et al.`;
}

function citationAuthorName(author: string): string {
  const clean = author.replace(/\s+/g, " ").trim();
  const comma = clean.indexOf(",");
  if (comma > 0) return clean.slice(0, comma).trim();
  if (isInstitutionalAuthor(clean)) return clean;
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return clean;
  return parts[parts.length - 1].replace(/^[([{]+|[)\]}.,;:]+$/g, "");
}

function isInstitutionalAuthor(author: string): boolean {
  return /archivo|asociaci[oó]n|centro|direcci[oó]n|google|gobierno|ign|inei|ingemmet|instituto|ministerio|minam|municipalidad|proyecto|senamhi|sernanp|servicio|universidad/i.test(author);
}

function citationYear(entry: KuiReferenceEntry | undefined): string {
  return entry?.year?.trim() || "s. f.";
}

function citationLocator(locator: string | undefined): string {
  const text = locator?.trim();
  if (!text) return "";
  if (/^(p|pp|cap|fig|tabla|sec)\./i.test(text)) return text;
  if (/^\d+(?:[-–]\d+)?$/.test(text)) return `p. ${text}`;
  return text;
}

function refText(node: CrossRefNode, ctx?: NativePdfContext): string {
  const info = ctx?.labels.get(node.id);
  const [kind, fallbackValue] = node.id.split(":");
  const labels: Record<string, string> = { fig: "Figura", tbl: "Tabla", eq: "Ecuación", sec: "Sección", def: "Definición", thm: "Teorema" };
  const labelType = info?.type ?? node.refType ?? kind;
  return `${labels[labelType] ?? labelType} ${info?.number ?? fallbackValue}`;
}

function footnoteMarker(node: FootnoteRefNode, ctx?: NativePdfContext): string {
  if (!ctx) return "";
  let number = ctx.footnoteNumbers.get(node.id);
  if (!number) {
    number = ctx.footnoteNumbers.size + 1;
    ctx.footnoteNumbers.set(node.id, number);
  }
  ctx.currentInlineFootnotes.push(node.id);
  return `[${number}]`;
}

export function formatMath(content: string): string {
  return safePdfText(content
    .trim()
    .replace(/\\rho/g, "ρ")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\_/g, "_")
    .replace(/[{}]/g, ""));
}

export function safePdfText(value: string): string {
  let text = value;
  for (let index = 0; index < 4; index += 1) {
    text = text.replace(/\\(?:texttt|textbf|textit|emph|underline|textsc)\s*\{([^{}]*)\}/g, "$1");
  }
  return text
    .replace(/\\(?:ldots|dots)\s*(?:\{\})?/g, "...")
    .replace(/\\(?:includegraphics|includepdf)\s*(?:\[[^\]]*\])?\s*(?:\{[^{}]*\})?/g, "")
    .replace(/\\(?:makeatletter|makeatother|newpage|clearpage)\b/g, "")
    .replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:renewcommand|setcounter|refstepcounter)\b(?:\[[^\]]*\])?(?:\s*\{[^{}]*\}){0,4}/g, "")
    .replace(/\\([#$%&_{}])/g, "$1")
    .replace(/\\([A-Za-z]+)\s*\{([^{}]*)\}/g, "$2")
    .replace(/\\([A-Za-z]+)\b/g, "$1")
    .replace(/\{(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, "")
    .replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])\}/g, "$1")
    .replace(/\u00A0/g, " ")
    .replace(/\n/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/≈/g, "~")
    .replace(/×/g, "x")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/ρ/g, "rho");
}
