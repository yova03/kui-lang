import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import type {
  BlockNode,
  CitationNode,
  CrossRefNode,
  DocumentNode,
  FigureNode,
  FootnoteRefNode,
  FencedDivNode,
  HeadingNode,
  InlineNode,
  ListNode,
  MathBlockNode,
  TableNode
} from "../core/ast.js";
import type { Diagnostic } from "../core/diagnostics.js";
import type { CompileOptions } from "../core/project.js";
import { resolveTemplate, type TemplateManifest } from "../templates/registry.js";

export interface NativePdfOutput {
  pdfPath: string;
  pdfBytes: Uint8Array;
  diagnostics: Diagnostic[];
  pageMap: NativePdfPageMap;
}

export interface NativePdfPageMap {
  headings: HeadingInfo[];
  labels: Record<string, LabelInfo>;
  footnotes: Array<{ id: string; number: number; page: number }>;
}

export interface LabelInfo {
  type: CrossRefNode["refType"];
  number: string;
  title?: string;
  page?: number;
}

export interface HeadingInfo {
  level: number;
  title: string;
  id?: string;
  page?: number;
}

interface TocPlaceholder {
  headingIndex: number;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
}

interface PageFootnote {
  id: string;
  number: number;
  text: string;
}

interface NativePdfContext {
  doc: PDFKit.PDFDocument;
  document: DocumentNode;
  options: CompileOptions;
  template: TemplateManifest;
  fonts: FontSet;
  diagnostics: Diagnostic[];
  labels: Map<string, LabelInfo>;
  headingCounters: number[];
  figureCount: number;
  tableCount: number;
  equationCount: number;
  headings: HeadingInfo[];
  headingRenderIndex: number;
  tocPlaceholders: TocPlaceholder[];
  footnotes: Map<string, string>;
  footnoteNumbers: Map<string, number>;
  footnotePages: Map<string, number>;
  pageFootnotes: Map<number, PageFootnote[]>;
  pageFootnoteReserves: Map<number, number>;
  currentInlineFootnotes: string[];
}

interface TableStyle {
  borderColor: string;
  headerFill: string;
  zebraFill: string;
  ruleMode: "grid" | "booktabs";
  fontSize: number;
  headerFontSize: number;
  paddingX: number;
  paddingY: number;
  lineGap: number;
  minRowHeight: number;
}

interface TableCellLayout {
  text: string;
  lines: string[];
  align: "left" | "center" | "right";
}

interface TableRowLayout {
  cells: TableCellLayout[];
  height: number;
  lineCount: number;
  header: boolean;
}

type FontRole = "body" | "bold" | "italic" | "boldItalic" | "serif" | "serifBold" | "serifItalic" | "mono";

interface FontSet extends Record<FontRole, string> {
  family: string;
}

interface FontFamilyDefinition {
  family: string;
  regular: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

interface SemanticItem {
  label: string;
  value: string;
  detail?: string;
}

const BUILT_IN_FONTS: FontSet = {
  family: "PDF built-ins",
  body: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
  serif: "Times-Roman",
  serifBold: "Times-Bold",
  serifItalic: "Times-Italic",
  mono: "Courier"
};

const FONT_FAMILIES: Record<string, FontFamilyDefinition> = {
  "arial narrow": {
    family: "Arial Narrow",
    regular: "/System/Library/Fonts/Supplemental/Arial Narrow.ttf",
    bold: "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
    italic: "/System/Library/Fonts/Supplemental/Arial Narrow Italic.ttf",
    boldItalic: "/System/Library/Fonts/Supplemental/Arial Narrow Bold Italic.ttf"
  }
};

export async function emitNativePdf(document: DocumentNode, options: CompileOptions): Promise<NativePdfOutput> {
  mkdirSync(options.outputDir, { recursive: true });
  const mainName = document.sourceFiles[0]
    ? path.basename(document.sourceFiles[0], path.extname(document.sourceFiles[0]))
    : "main";
  const pdfPath = path.join(options.outputDir, `${mainName}.pdf`);
  const template = resolveTemplate(document.frontmatter?.data.template);
  const margins = template.defaultStyle.margins;

  const doc = new PDFDocument({
    size: "A4",
    margins,
    bufferPages: true,
    info: {
      Title: String(document.frontmatter?.data.title ?? "KUI Document"),
      Author: authorText(document.frontmatter?.data.author)
    }
  });
const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const fonts = registerDocumentFonts(doc, document.frontmatter?.data, options, document.sourceFiles[0]);

  const ctx: NativePdfContext = {
    doc,
    document,
    options,
    template,
    fonts,
    diagnostics: [...document.diagnostics],
    labels: collectLabels(document.children),
    headingCounters: [0, 0, 0, 0, 0, 0],
    figureCount: 0,
    tableCount: 0,
    equationCount: 0,
    headings: collectHeadings(document.children),
    headingRenderIndex: 0,
    tocPlaceholders: [],
    footnotes: collectFootnotes(document.children),
    footnoteNumbers: new Map(),
    footnotePages: new Map(),
    pageFootnotes: new Map(),
    pageFootnoteReserves: new Map(),
    currentInlineFootnotes: []
  };

  renderTitle(ctx);
  for (const block of document.children) await renderBlock(block, ctx);
  renderFootnotes(ctx);
  renderTocPageNumbers(ctx);
  renderPageNumbers(ctx);

  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  doc.end();
  const bytes = await done;
  await import("node:fs/promises").then((fs) => fs.writeFile(pdfPath, bytes));
  return { pdfPath, pdfBytes: new Uint8Array(bytes), diagnostics: ctx.diagnostics, pageMap: nativePdfPageMap(ctx) };
}

function registerDocumentFonts(
  doc: PDFKit.PDFDocument,
  data: Record<string, unknown> | undefined,
  options: CompileOptions,
  sourceFile?: string
): FontSet {
  const customDefinition = customFontDefinition(data, options, sourceFile);
  if (customDefinition && existsSync(customDefinition.regular)) {
    return registerFontDefinition(doc, customDefinition);
  }

  const requested = requestedFontFamily(data);
  if (!requested) return BUILT_IN_FONTS;

  const definition = FONT_FAMILIES[normalizeFontFamilyName(requested)];
  if (!definition || !existsSync(definition.regular)) return BUILT_IN_FONTS;
  return registerFontDefinition(doc, definition);
}

function registerFontDefinition(doc: PDFKit.PDFDocument, definition: FontFamilyDefinition): FontSet {
  const prefix = `KUI-${definition.family.replace(/[^A-Za-z0-9]/g, "")}`;
  const register = (role: string, file: string | undefined): string => {
    const fontFile = file && existsSync(file) ? file : definition.regular;
    const alias = `${prefix}-${role}`;
    doc.registerFont(alias, fontFile);
    return alias;
  };

  const regular = register("Regular", definition.regular);
  const bold = register("Bold", definition.bold);
  const italic = register("Italic", definition.italic);
  const boldItalic = register("BoldItalic", definition.boldItalic ?? definition.bold ?? definition.italic);

  return {
    family: definition.family,
    body: regular,
    bold,
    italic,
    boldItalic,
    serif: regular,
    serifBold: bold,
    serifItalic: italic,
    mono: BUILT_IN_FONTS.mono
  };
}

function customFontDefinition(
  data: Record<string, unknown> | undefined,
  options: CompileOptions,
  sourceFile?: string
): FontFamilyDefinition | undefined {
  const fonts = data?.fonts;
  if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) return undefined;
  const record = fonts as Record<string, unknown>;
  const regular = frontmatterText(record.regular ?? record.body);
  if (!regular) return undefined;
  const family = frontmatterText(record.family ?? record.name) || requestedFontFamily(data) || "Custom";
  return {
    family,
    regular: resolveFontPath(regular, options, sourceFile),
    bold: optionalFontPath(record.bold, options, sourceFile),
    italic: optionalFontPath(record.italic, options, sourceFile),
    boldItalic: optionalFontPath(record.boldItalic ?? record.bold_italic, options, sourceFile)
  };
}

function optionalFontPath(value: unknown, options: CompileOptions, sourceFile?: string): string | undefined {
  const text = frontmatterText(value);
  return text ? resolveFontPath(text, options, sourceFile) : undefined;
}

function resolveFontPath(rawPath: string, options: CompileOptions, sourceFile?: string): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(sourceFile ? path.dirname(sourceFile) : options.cwd, rawPath);
}

function requestedFontFamily(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const direct = frontmatterText(data.fontFamily ?? data.font ?? data.typography);
  if (direct) return direct;
  const fonts = data.fonts;
  if (fonts && typeof fonts === "object" && !Array.isArray(fonts)) {
    const record = fonts as Record<string, unknown>;
    return frontmatterText(record.family ?? record.body);
  }
  return "";
}

function normalizeFontFamilyName(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function fontName(ctx: NativePdfContext, role: FontRole): string {
  return ctx.fonts[role] ?? BUILT_IN_FONTS[role];
}

function renderTitle(ctx: NativePdfContext): void {
  if (ctx.template.id === "informe-operativo") {
    renderOperationalCover(ctx);
    return;
  }
  if (ctx.template.id === "article-digital-economy") {
    renderArticleTitle(ctx);
    return;
  }

  const data = ctx.document.frontmatter?.data ?? {};
  const title = String(data.title ?? "Untitled KUI Document");
  const author = authorText(data.author);
  const date = String(data.date ?? new Date().getFullYear());
  ensureSpace(ctx, 130);
  ctx.doc
    .font(fontName(ctx, "bold"))
    .fontSize(22)
    .fillColor("#111111")
    .text(title, { align: "center" })
    .moveDown(0.5);
  if (author) ctx.doc.font(fontName(ctx, "body")).fontSize(12).fillColor("#333333").text(author, { align: "center" });
  ctx.doc.fontSize(11).fillColor("#555555").text(date, { align: "center" }).moveDown(2);
}

function renderOperationalCover(ctx: NativePdfContext): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const colors = ctx.template.defaultStyle.colors;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const heroY = 100;
  const heroHeight = 312;

  ctx.doc.rect(x, heroY, width, heroHeight).fill(colors.primary);
  ctx.doc
    .font(fontName(ctx, "serifBold"))
    .fontSize(25)
    .fillColor("#FFFFFF")
    .text(String(data.title ?? "Reporte operativo"), x + 24, heroY + 58, { width: width - 48, lineGap: 2 });
  ctx.doc
    .font(fontName(ctx, "bold"))
    .fontSize(11)
    .fillColor(colors.accent)
    .text(String(data.subtitle ?? ""), x + 24, heroY + 150, { width: width - 48 });
  ctx.doc
    .font(fontName(ctx, "body"))
    .fontSize(10)
    .fillColor("#FFFFFF")
    .text(`Dirigido a: ${frontmatterText(data.directedTo)}`, x + 24, heroY + 176, { width: width - 48 })
    .text(`Area: ${frontmatterText(data.area)}`, { width: width - 48 })
    .text(`Periodo reportado: ${frontmatterText(data.period)}`, { width: width - 48 });
  ctx.doc.moveTo(x + 24, heroY + 238).lineTo(x + width - 24, heroY + 238).lineWidth(1.2).stroke(colors.accent);
  ctx.doc
    .font(fontName(ctx, "serifBold"))
    .fontSize(20)
    .fillColor("#FFFFFF")
    .text(String(data.organization ?? ""), x + 24, heroY + 250, { width: width - 48 });
  ctx.doc
    .font(fontName(ctx, "body"))
    .fontSize(8)
    .fillColor(colors.accent)
    .text(String(data.organizationLine ?? ""), x + 24, heroY + 278, { width: width - 48 });

  renderCoverMetadata(ctx, heroY + heroHeight + 24);
  renderMetricPills(ctx);
  ctx.doc.addPage();
}

function renderCoverMetadata(ctx: NativePdfContext, y: number): void {
  const items = frontmatterPairs(ctx.document.frontmatter?.data.metadata);
  if (items.length === 0) return;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const rowHeight = 29;
  const height = Math.max(80, items.length * rowHeight + 20);
  ctx.doc.roundedRect(x, y, width, height, 4).stroke("#CBD5E1");
  items.forEach((item, index) => {
    const rowY = y + 18 + index * rowHeight;
    ctx.doc.font(fontName(ctx, "bold")).fontSize(9).fillColor("#667085").text(item.label, x + 18, rowY, { width: 145 });
    ctx.doc.font(fontName(ctx, "body")).fontSize(9).fillColor("#111827").text(item.value, x + 170, rowY, { width: width - 195 });
  });
}

function renderMetricPills(ctx: NativePdfContext): void {
  const metrics = frontmatterPairs(ctx.document.frontmatter?.data.metrics);
  if (metrics.length === 0) return;
  const colors = ["#D7F3E6", "#F7DDCF", "#DCE7FA", "#E9DDF7", "#D6F0E2", "#F7E5C2"];
  const textColors = ["#087345", "#A0461D", "#2C5C9F", "#7653A6", "#087345", "#B36A00"];
  const x = ctx.doc.page.margins.left + 8;
  const y = ctx.doc.page.height - ctx.doc.page.margins.bottom - 18;
  const gap = 8;
  const pillWidth = (contentWidth(ctx) - gap * (metrics.length - 1) - 16) / metrics.length;
  metrics.forEach((item, index) => {
    const pillX = x + index * (pillWidth + gap);
    ctx.doc.roundedRect(pillX, y, pillWidth, 12, 6).fill(colors[index % colors.length]);
    ctx.doc
      .font(fontName(ctx, "bold"))
      .fontSize(5.6)
      .fillColor(textColors[index % textColors.length])
      .text(item.value || item.label, pillX + 4, y + 3, { lineBreak: false });
  });
}

function renderArticleTitle(ctx: NativePdfContext): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  ctx.doc
    .font(fontName(ctx, "body"))
    .fontSize(9)
    .fillColor("#111111")
    .text(safePdfText(String(data.kicker ?? `${authorText(data.author).toUpperCase()} / ACADEMIC ARTICLE / KUI EDITION`)), x, 70, { width });
  ctx.doc
    .font(fontName(ctx, "serifBold"))
    .fontSize(28)
    .fillColor("#111111")
    .text(safePdfText(String(data.title ?? "Untitled")), x, 104, { width, lineGap: 2 });
  ctx.doc
    .font(fontName(ctx, "serifItalic"))
    .fontSize(12)
    .fillColor("#111111")
    .text(safePdfText(String(data.subtitle ?? "")), x, ctx.doc.y + 10, { width, lineGap: 2 });
  drawArticleOrnament(ctx, x, ctx.doc.y + 28, width * 0.68);
  const keywords = frontmatterList(data.keywords);
  const tags = frontmatterList(data.tags);
  if (tags.length > 0 || keywords.length > 0) renderArticleSidebar(ctx, x + width * 0.72, 335, width * 0.25, tags, keywords);
  ctx.doc.x = ctx.doc.page.margins.left;
  ctx.doc.y = 430;
}

function drawArticleOrnament(ctx: NativePdfContext, x: number, y: number, width: number): void {
  ctx.doc.moveTo(x, y + 32)
    .bezierCurveTo(x + width * 0.18, y - 2, x + width * 0.30, y + 62, x + width * 0.48, y + 28)
    .bezierCurveTo(x + width * 0.65, y - 5, x + width * 0.72, y + 56, x + width, y + 24)
    .stroke("#111111");
  ctx.doc.ellipse(x + width * 0.46, y, 30, 10).stroke("#111111");
  ctx.doc.circle(x + width * 0.78, y + 38, 2.2).fill("#111111");
}

function renderArticleSidebar(ctx: NativePdfContext, x: number, y: number, width: number, tags: string[], keywords: string[]): void {
  let cursorX = x;
  let cursorY = y;
  tags.forEach((tag) => {
    const tagWidth = Math.min(width, Math.max(32, ctx.doc.widthOfString(tag) + 14));
    if (cursorX + tagWidth > x + width) {
      cursorX = x;
      cursorY += 20;
    }
    ctx.doc.rect(cursorX, cursorY, tagWidth, 14).fill("#111111");
    ctx.doc.font(fontName(ctx, "mono")).fontSize(7).fillColor("#FFFFFF").text(tag, cursorX + 5, cursorY + 4, { width: tagWidth - 10, align: "center" });
    cursorX += tagWidth + 5;
  });
  if (keywords.length === 0) return;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#111111").text("Keywords", x, cursorY + 30, { width, align: "right" });
  ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#111111").text(keywords.join("\n"), x, cursorY + 44, { width, align: "right", lineGap: 2 });
}

async function renderBlock(block: BlockNode, ctx: NativePdfContext): Promise<void> {
  switch (block.kind) {
    case "Heading":
      renderHeading(block, ctx);
      return;
    case "Paragraph":
      renderParagraph(block.children, ctx);
      return;
    case "List":
      renderList(block, ctx);
      return;
    case "Blockquote":
      renderBox("Cita", block.children, ctx, "#F6F6F6", "#666666");
      return;
    case "Callout":
      renderBox(block.calloutType, block.children, ctx, "#EEF6FF", "#2B6CB0");
      return;
    case "CodeBlock":
      renderCode(block.content, ctx);
      return;
    case "MathBlock":
      renderEquation(block, ctx);
      return;
    case "Figure":
      await renderFigure(block, ctx);
      return;
    case "Table":
      renderTable(block, ctx);
      return;
    case "FencedDiv":
      await renderFencedDiv(block, ctx);
      return;
    case "Directive":
      await renderDirective(block.name, ctx);
      return;
    case "FootnoteDef":
      return;
    case "HorizontalRule":
      drawRule(ctx);
      return;
  }
}

function renderHeading(block: HeadingNode, ctx: NativePdfContext): void {
  const level = block.attrs?.classes.includes("chapter") ? 1 : block.level;
  ctx.headingCounters[level - 1] += 1;
  for (let index = level; index < ctx.headingCounters.length; index++) ctx.headingCounters[index] = 0;
  const number = ctx.labels.get(block.attrs?.id ?? "")?.number ?? ctx.headingCounters.slice(0, level).filter(Boolean).join(".");
  const rawTitle = inlineText(block.title, ctx);
  if (ctx.template.id === "article-digital-economy" && level === 1) {
    renderArticleSectionHeading(number, rawTitle, ctx);
    markHeadingPage(ctx, block);
    return;
  }
  if (ctx.template.id === "article-digital-economy") {
    renderArticlePlainHeading(rawTitle, level, ctx);
    markHeadingPage(ctx, block);
    return;
  }
  if (ctx.template.id === "informe-operativo") {
    renderReportHeading(rawTitle, level, ctx);
    markHeadingPage(ctx, block);
    return;
  }
  const title = `${number ? `${number} ` : ""}${rawTitle}`;
  const sizes = [18, 15, 13, 11, 10, 10];
  ensureSpace(ctx, sizes[level - 1] + 28);
  ctx.doc.moveDown(level === 1 ? 1 : 0.6);
  const displayedTitle = /^\d+(?:\.\d+)*\s/.test(rawTitle) ? rawTitle : title;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(sizes[level - 1] ?? 11).fillColor("#111111").text(displayedTitle);
  ctx.doc.moveDown(0.35);
  markHeadingPage(ctx, block);
}

function renderArticleSectionHeading(number: string, title: string, ctx: NativePdfContext): void {
  const textWidth = contentWidth(ctx) - 42;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(16);
  const titleHeight = ctx.doc.heightOfString(title, { width: textWidth });
  const blockHeight = Math.max(42, titleHeight + 18);
  ensureSpace(ctx, blockHeight + 12);
  ctx.doc.moveDown(1);
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  ctx.doc.rect(x, y + 2, 28, 22).fill("#111111");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#FFFFFF").text(number, x, y + 9, { width: 28, align: "center" });
  ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#111111").text(title, x + 42, y + 5, { width: textWidth });
  ctx.doc.x = x;
  ctx.doc.y = y + blockHeight;
}

function renderArticlePlainHeading(title: string, level: number, ctx: NativePdfContext): void {
  const sizes = [18, 15, 12, 10, 10, 10];
  const fontSize = sizes[level - 1] ?? 10;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(fontSize);
  const height = ctx.doc.heightOfString(title, { width: contentWidth(ctx), lineGap: 1 });
  ensureSpace(ctx, height + 24);
  ctx.doc.moveDown(level === 2 ? 0.85 : 0.55);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(fontSize).fillColor("#111111").text(title, {
    width: contentWidth(ctx),
    lineGap: 1
  });
  ctx.doc.moveDown(0.3);
}

function renderReportHeading(title: string, level: number, ctx: NativePdfContext): void {
  const sizes = [14, 12, 10, 10, 9, 9];
  ensureSpace(ctx, sizes[level - 1] + 28);
  ctx.doc.moveDown(level === 1 ? 1 : 0.6);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(sizes[level - 1] ?? 10).fillColor("#111111").text(title);
  ctx.doc.moveDown(0.35);
}

function renderParagraph(children: InlineNode[], ctx: NativePdfContext): void {
  const text = captureInlineText(children, ctx);
  if (ctx.template.id === "article-digital-economy") {
    renderArticleParagraph(text, ctx);
    return;
  }
  const footnoteRefs = consumeInlineFootnotes(ctx);
  const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
  ensureSpace(ctx, ctx.doc.heightOfString(text, { width: contentWidth(ctx), align: "justify", lineGap: 2 }) + 16 + footnoteHeight);
  registerFootnotesOnCurrentPage(footnoteRefs, ctx);
  ctx.doc.font(fontName(ctx, "body")).fontSize(11).fillColor("#222222").text(text, {
    align: "justify",
    lineGap: 2
  });
  ctx.doc.moveDown(0.8);
}

function renderArticleParagraph(text: string, ctx: NativePdfContext): void {
  ctx.doc.font(fontName(ctx, "serif")).fontSize(11);
  const footnoteRefs = consumeInlineFootnotes(ctx);
  const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
  ensureSpace(ctx, ctx.doc.heightOfString(text, { width: contentWidth(ctx), align: "left", lineGap: 2 }) + 12 + footnoteHeight);
  registerFootnotesOnCurrentPage(footnoteRefs, ctx);
  ctx.doc.font(fontName(ctx, "serif")).fontSize(11).fillColor("#111111").text(text, {
    align: "left",
    lineGap: 2
  });
  ctx.doc.moveDown(0.65);
}

function renderList(block: ListNode, ctx: NativePdfContext): void {
  block.items.forEach((item, index) => {
    const marker = block.ordered ? `${index + 1}.` : item.checked === undefined ? "-" : item.checked ? "[x]" : "[ ]";
    const text = `${marker} ${captureInlineText(item.children, ctx)}`;
    const footnoteRefs = consumeInlineFootnotes(ctx);
    const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
    ensureSpace(ctx, ctx.doc.heightOfString(text, { width: contentWidth(ctx), indent: 18, lineGap: 1 }) + 4 + footnoteHeight);
    registerFootnotesOnCurrentPage(footnoteRefs, ctx);
    ctx.doc.font(fontName(ctx, "body")).fontSize(11).fillColor("#222222").text(text, {
      indent: 18,
      lineGap: 1
    });
  });
  ctx.doc.moveDown(0.6);
}

function renderCode(content: string, ctx: NativePdfContext): void {
  const width = ctx.doc.page.width - ctx.doc.page.margins.left - ctx.doc.page.margins.right;
  const safeContent = safePdfText(content);
  const height = Math.max(34, ctx.doc.font(fontName(ctx, "mono")).fontSize(9).heightOfString(safeContent, { width }) + 18);
  ensureSpace(ctx, height + 12);
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  ctx.doc.roundedRect(x, y, width, height, 4).fill("#F4F4F5");
  ctx.doc.fillColor("#111111").font(fontName(ctx, "mono")).fontSize(9).text(safeContent, x + 9, y + 9, { width: width - 18 });
  ctx.doc.y = y + height + 12;
}

function renderEquation(block: MathBlockNode, ctx: NativePdfContext): void {
  ctx.equationCount += 1;
  const number = ctx.labels.get(block.attrs?.id ?? "")?.number ?? String(ctx.equationCount);
  const label = `(${number})`;
  ensureSpace(ctx, 58);
  markLabelPage(ctx, block.attrs?.id);
  ctx.doc
    .font(fontName(ctx, "serifItalic"))
    .fontSize(13)
    .fillColor("#111111")
    .text(formatMath(block.content), { align: "center" });
  ctx.doc.font(fontName(ctx, "body")).fontSize(9).fillColor("#555555").text(label, { align: "right" }).moveDown(0.8);
}

async function renderFigure(block: FigureNode, ctx: NativePdfContext): Promise<void> {
  ctx.figureCount += 1;
  const number = ctx.labels.get(block.attrs?.id ?? "")?.number ?? String(ctx.figureCount);
  const caption = `Figura ${number}. ${inlineText(block.caption, ctx)}`;
  const imagePath = resolveNodePath(block.path, block, ctx);
  const maxWidth = ctx.doc.page.width - ctx.doc.page.margins.left - ctx.doc.page.margins.right;
  ensureSpace(ctx, 350);
  markLabelPage(ctx, block.attrs?.id);
  try {
    ctx.doc.image(imagePath, { fit: [maxWidth, 300], align: "center" });
    ctx.doc.moveDown(0.4);
  } catch {
    ctx.doc
      .font(fontName(ctx, "italic"))
      .fontSize(10)
      .fillColor("#9A3412")
      .text(`[Imagen no renderizada: ${block.path}]`, { align: "center" });
    ctx.diagnostics.push({
      code: "KUI-W090",
      severity: "warning",
      message: `No se pudo renderizar la imagen: ${block.path}`,
      position: block.position
    });
  }
  ctx.doc.font(fontName(ctx, "body")).fontSize(9).fillColor("#444444").text(caption, { align: "center" }).moveDown(0.8);
}

function renderTable(block: TableNode, ctx: NativePdfContext): void {
  ctx.tableCount += 1;
  const number = ctx.labels.get(block.attrs?.id ?? "")?.number ?? String(ctx.tableCount);
  const caption = block.caption ? `Tabla ${number}. ${inlineText(block.caption, ctx)}` : `Tabla ${number}`;
  const showCaption = ctx.template.id !== "article-digital-economy";
  const columnCount = tableColumnCount(block);
  const style = tableStyle(columnCount, ctx);
  const widths = columnWidths(block, columnCount, ctx, style);
  const alignments = normalizeTableAlignments(block.alignments, columnCount);
  const header = layoutTableRow(normalizeTableRow(block.headers, columnCount), widths, ctx, true, style, alignments);
  const rows = block.rows.map((row) => layoutTableRow(normalizeTableRow(row, columnCount), widths, ctx, false, style, alignments));
  const captionHeight = showCaption ? ctx.doc.font(fontName(ctx, "bold")).fontSize(10).heightOfString(caption, { width: contentWidth(ctx), lineGap: 1 }) + 10 : 0;

  ensureSpace(ctx, captionHeight + header.height + style.minRowHeight);
  markLabelPage(ctx, block.attrs?.id);
  ctx.doc.x = ctx.doc.page.margins.left;
  if (showCaption) {
    ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111111").text(caption, { width: contentWidth(ctx), lineGap: 1 });
    ctx.doc.moveDown(0.25);
  }
  drawTableRow(header, widths, ctx, style);
  rows.forEach((row, index) => renderTableBodyRow(row, header, widths, ctx, style, index));
  ctx.doc.moveDown(0.8);
  ctx.doc.x = ctx.doc.page.margins.left;
}

async function renderFencedDiv(block: FencedDivNode, ctx: NativePdfContext): Promise<void> {
  const name = block.canonicalName ?? block.name;
  if (name === "executive-summary") {
    renderExecutiveSummary(block, ctx);
    return;
  }
  if (name === "kpi-grid") {
    renderKpiGrid(block, ctx);
    return;
  }
  if (name === "risk-matrix") {
    renderRiskMatrix(block, ctx);
    return;
  }
  if (name === "status-grid") {
    renderStatusGrid(block, ctx);
    return;
  }
  if (name === "timeline") {
    renderTimeline(block, ctx);
    return;
  }
  if (name === "signature") {
    renderSignature(block, ctx);
    return;
  }
  if (name === "abstract") {
    if (ctx.template.id === "article-digital-economy") {
      renderArticleAbstract(block.children, ctx);
      return;
    }
    renderBox("Resumen", block.children, ctx, "#F7FAFC", "#2D3748");
    return;
  }
  if (["theorem", "definition", "lemma", "corollary", "proof"].includes(name)) {
    const titles: Record<string, string> = {
      theorem: "Teorema",
      definition: "Definición",
      lemma: "Lema",
      corollary: "Corolario",
      proof: "Demostración"
    };
    renderBox(titles[name] ?? name, block.children, ctx, "#FFFBEB", "#92400E");
    return;
  }
  if (["note", "warning", "todo", "box"].includes(name)) {
    if (ctx.template.id === "article-digital-economy") {
      renderBox("", block.children, ctx, "#FFFFFF", "#111111");
      return;
    }
    renderBox(name === "warning" ? "Aviso" : name === "todo" ? "Pendiente" : "Nota", block.children, ctx, "#EEF6FF", "#1D4ED8");
    return;
  }
  if (name === "center") {
    ctx.doc.text(block.children.map((child) => blockText(child, ctx)).join("\n"), { align: "center" }).moveDown();
    return;
  }
  for (const child of block.children) await renderBlock(child, ctx);
}

async function renderDirective(name: string, ctx: NativePdfContext): Promise<void> {
  if (name === "toc") {
    if (ctx.template.id === "informe-operativo") {
      renderOperationalToc(ctx);
      return;
    }
    const x = ctx.doc.page.margins.left;
    const width = contentWidth(ctx);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#111111").text("Índice", x, ctx.doc.y, { width }).moveDown(0.5);
    ctx.headings.forEach((heading, headingIndex) => {
      const y = ctx.doc.y;
      ctx.doc
        .font(fontName(ctx, "body"))
        .fontSize(10)
        .fillColor("#333333")
        .text(`${"  ".repeat(Math.max(0, heading.level - 1))}${heading.title}`, x, y, {
          width: width - 42,
          lineBreak: false
        });
      ctx.doc
        .moveTo(x + width - 36, y + 8)
        .lineTo(x + width - 12, y + 8)
        .dash(1.2, { space: 2.2 })
        .stroke("#CBD5E1")
        .undash();
      ctx.tocPlaceholders.push({ headingIndex, pageIndex: currentPageIndex(ctx), x: x + width - 30, y, width: 30 });
      ctx.doc.y = y + 17;
    });
    ctx.doc.moveDown(1);
    return;
  }
  if (name === "lof") {
    ctx.doc.font(fontName(ctx, "bold")).fontSize(14).text("Lista de figuras").moveDown(0.6);
    return;
  }
  if (name === "lot") {
    ctx.doc.font(fontName(ctx, "bold")).fontSize(14).text("Lista de tablas").moveDown(0.6);
    return;
  }
  if (name === "bibliography") {
    await renderBibliography(ctx);
    return;
  }
  if (name === "newpage" || name === "clearpage") {
    ctx.doc.addPage();
  }
}

function renderOperationalToc(ctx: NativePdfContext): void {
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const headings = ctx.headings
    .map((heading, headingIndex) => ({ ...heading, headingIndex }))
    .filter((heading) => heading.level === 1);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(15).fillColor("#111111").text("Índice", x, ctx.doc.y, { width });
  ctx.doc.moveDown(0.75);

  headings.forEach((heading) => {
    const title = heading.title;
    const y = ctx.doc.y + 2;
    ensureSpace(ctx, 20);
    ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#111111").text(title, x, y, {
      width: width - 42,
      lineBreak: false
    });
    const textWidth = Math.min(width - 60, ctx.doc.widthOfString(title) + 4);
    ctx.doc
      .moveTo(x + textWidth, y + 8)
      .lineTo(x + width - 28, y + 8)
      .dash(1.2, { space: 2.2 })
      .stroke("#A8A29E")
      .undash();
    ctx.tocPlaceholders.push({ headingIndex: heading.headingIndex, pageIndex: currentPageIndex(ctx), x: x + width - 24, y, width: 24 });
    ctx.doc.y = y + 19;
  });
  ctx.doc.moveDown(0.5);
}

function renderBox(title: string, children: BlockNode[], ctx: NativePdfContext, fill: string, stroke: string): void {
  const text = children.map((child) => blockText(child, ctx)).filter(Boolean).join("\n\n");
  const width = ctx.doc.page.width - ctx.doc.page.margins.left - ctx.doc.page.margins.right;
  ctx.doc.font(fontName(ctx, "body")).fontSize(10);
  const bodyHeight = Math.max(36, ctx.doc.heightOfString(text, { width: width - 24, lineGap: 2 }) + 42);
  ensureSpace(ctx, bodyHeight + 12);
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  ctx.doc.roundedRect(x, y, width, bodyHeight, 6).fillAndStroke(fill, stroke);
  const bodyY = title ? y + 26 : y + 12;
  if (title) ctx.doc.fillColor(stroke).font(fontName(ctx, "bold")).fontSize(10).text(title, x + 12, y + 10, { width: width - 24 });
  ctx.doc.fillColor("#111111").font(fontName(ctx, "body")).fontSize(10).text(text, x + 12, bodyY, { width: width - 24, lineGap: 2 });
  ctx.doc.y = y + bodyHeight + 12;
}

function renderExecutiveSummary(block: FencedDivNode, ctx: NativePdfContext): void {
  const text = block.children.map((child) => blockText(child, ctx)).filter(Boolean).join("\n\n");
  const title = semanticTitle(block, "Resumen operativo");
  const width = contentWidth(ctx);
  const bodyWidth = width - 34;
  ctx.doc.font(fontName(ctx, "body")).fontSize(10.5);
  const textHeight = ctx.doc.heightOfString(text, { width: bodyWidth, lineGap: 2 });
  const height = Math.max(94, textHeight + 48);
  ensureSpace(ctx, height + 14);

  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  const colors = ctx.template.defaultStyle.colors;
  ctx.doc.roundedRect(x, y, width, height, 6).fillAndStroke("#F8FAFC", "#CBD5E1");
  ctx.doc.rect(x, y, 7, height).fill(colors.secondary);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(9).fillColor(colors.secondary).text(title.toUpperCase(), x + 18, y + 16, {
    width: bodyWidth,
    lineBreak: false
  });
  ctx.doc.font(fontName(ctx, "body")).fontSize(10.5).fillColor("#111827").text(text, x + 18, y + 36, {
    width: bodyWidth,
    lineGap: 2,
    align: "justify"
  });
  ctx.doc.x = x;
  ctx.doc.y = y + height + 14;
}

function renderKpiGrid(block: FencedDivNode, ctx: NativePdfContext): void {
  const items = semanticItemsFromChildren(block.children, ctx);
  if (items.length === 0) return;
  const title = semanticTitle(block, "Indicadores clave");
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const gap = 10;
  const columns = width > 460 ? 3 : 2;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = 72;
  const rows = Math.ceil(items.length / columns);
  const height = 28 + rows * cardHeight + (rows - 1) * gap;
  ensureSpace(ctx, height + 16);

  const colors = ctx.template.defaultStyle.colors;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, ctx.doc.y, { width });
  const startY = ctx.doc.y + 8;
  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cardX = x + col * (cardWidth + gap);
    const cardY = startY + row * (cardHeight + gap);
    ctx.doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 5).fillAndStroke("#FFFFFF", "#D7D0C4");
    ctx.doc.rect(cardX, cardY, 4, cardHeight).fill(index % 2 === 0 ? colors.secondary : colors.primary);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(15).fillColor(colors.primary).text(item.value || item.label, cardX + 13, cardY + 12, {
      width: cardWidth - 24,
      lineBreak: false
    });
    if (item.value) {
      ctx.doc.font(fontName(ctx, "body")).fontSize(8.2).fillColor("#475467").text(item.label, cardX + 13, cardY + 34, {
        width: cardWidth - 24,
        lineGap: 1
      });
    }
    if (item.detail) {
      ctx.doc.font(fontName(ctx, "body")).fontSize(7.2).fillColor("#667085").text(item.detail, cardX + 13, cardY + 49, {
        width: cardWidth - 24,
        lineGap: 0.6
      });
    }
  });
  ctx.doc.x = x;
  ctx.doc.y = startY + rows * cardHeight + (rows - 1) * gap + 16;
}

function renderRiskMatrix(block: FencedDivNode, ctx: NativePdfContext): void {
  const title = semanticTitle(block, "Matriz de riesgo operativo");
  const table = firstTable(block.children);
  if (!table) {
    renderStatusGrid(block, ctx);
    return;
  }
  renderSemanticTable(title, table, ctx, { priorityAware: true, compact: false });
}

function renderStatusGrid(block: FencedDivNode, ctx: NativePdfContext): void {
  const items = semanticItemsFromChildren(block.children, ctx);
  if (items.length === 0) return;
  const title = semanticTitle(block, "Estado operativo");
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const gap = 8;
  const columns = width > 460 ? 2 : 1;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = 48;
  const rows = Math.ceil(items.length / columns);
  ensureSpace(ctx, 28 + rows * cardHeight + rows * gap);

  ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, ctx.doc.y, { width });
  const startY = ctx.doc.y + 8;
  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cardX = x + col * (cardWidth + gap);
    const cardY = startY + row * (cardHeight + gap);
    const palette = tonePalette(`${item.value} ${item.label}`);
    ctx.doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 5).fillAndStroke(palette.fill, palette.stroke);
    ctx.doc.circle(cardX + 16, cardY + 18, 4).fill(palette.stroke);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(8.5).fillColor("#111827").text(item.label, cardX + 28, cardY + 10, {
      width: cardWidth - 38,
      lineBreak: false
    });
    ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#475467").text(item.value || item.detail || "", cardX + 28, cardY + 26, {
      width: cardWidth - 38,
      lineBreak: false
    });
  });
  ctx.doc.x = x;
  ctx.doc.y = startY + rows * cardHeight + (rows - 1) * gap + 14;
}

function renderTimeline(block: FencedDivNode, ctx: NativePdfContext): void {
  const items = semanticItemsFromChildren(block.children, ctx);
  if (items.length === 0) return;
  const title = semanticTitle(block, "Cronograma operativo");
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const colors = ctx.template.defaultStyle.colors;
  ensureSpace(ctx, 50);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, ctx.doc.y, { width });
  ctx.doc.moveDown(0.45);

  for (const item of items) {
    const labelWidth = 92;
    const bodyWidth = width - labelWidth - 28;
    ctx.doc.font(fontName(ctx, "body")).fontSize(9);
    const bodyHeight = Math.max(32, ctx.doc.heightOfString(item.value || item.label, { width: bodyWidth, lineGap: 1 }) + 16);
    ensureSpace(ctx, bodyHeight + 10);
    const y = ctx.doc.y;
    ctx.doc.moveTo(x + labelWidth + 11, y + 6).lineTo(x + labelWidth + 11, y + bodyHeight + 4).lineWidth(1).stroke("#CBD5E1");
    ctx.doc.circle(x + labelWidth + 11, y + 13, 4.5).fill(colors.secondary);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor(colors.primary).text(item.label, x, y + 7, {
      width: labelWidth,
      align: "right"
    });
    ctx.doc.font(fontName(ctx, "body")).fontSize(9).fillColor("#111827").text(item.value || item.detail || "", x + labelWidth + 28, y + 5, {
      width: bodyWidth,
      lineGap: 1.2
    });
    ctx.doc.y = y + bodyHeight + 6;
  }
  ctx.doc.x = x;
  ctx.doc.moveDown(0.3);
}

function renderSignature(block: FencedDivNode, ctx: NativePdfContext): void {
  const items = semanticItemsFromChildren(block.children, ctx);
  const data = ctx.document.frontmatter?.data ?? {};
  const fallback = [
    { label: authorText(data.author) || "Responsable", value: frontmatterText(data.area) || "Equipo de Operaciones" },
    { label: frontmatterText(data.directedTo) || "Recibido por", value: "Conformidad / revisión" }
  ];
  const signatures = items.length > 0 ? items : fallback;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const gap = 20;
  const columns = Math.min(2, signatures.length);
  const boxWidth = (width - gap * (columns - 1)) / columns;
  ensureSpace(ctx, 94);

  const title = semanticTitle(block, "Firmas y conformidad");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, ctx.doc.y, { width });
  const y = ctx.doc.y + 28;
  signatures.slice(0, 2).forEach((item, index) => {
    const boxX = x + index * (boxWidth + gap);
    ctx.doc.moveTo(boxX + 16, y + 38).lineTo(boxX + boxWidth - 16, y + 38).lineWidth(0.8).stroke("#667085");
    ctx.doc.font(fontName(ctx, "bold")).fontSize(9).fillColor("#111827").text(item.label, boxX, y + 46, {
      width: boxWidth,
      align: "center",
      lineBreak: false
    });
    ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#667085").text(item.value, boxX, y + 60, {
      width: boxWidth,
      align: "center",
      lineBreak: false
    });
  });
  ctx.doc.x = x;
  ctx.doc.y = y + 84;
}

function renderSemanticTable(
  title: string,
  table: TableNode,
  ctx: NativePdfContext,
  options: { priorityAware: boolean; compact: boolean }
): void {
  const headers = table.headers.map((cell) => inlineText(cell, ctx));
  const rows = table.rows.map((row) => row.map((cell) => inlineText(cell, ctx)));
  if (headers.length === 0) return;
  const widths = semanticColumnWidths(headers, rows, ctx);
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const headerHeight = options.compact ? 22 : 25;
  ensureSpace(ctx, 44 + headerHeight);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, ctx.doc.y, { width });
  ctx.doc.moveDown(0.35);
  drawSemanticTableHeader(headers, widths, ctx, headerHeight);

  rows.forEach((row, index) => {
    const rowHeight = semanticRowHeight(row, widths, ctx, options.compact);
    if (!hasSpace(ctx, rowHeight)) {
      ctx.doc.addPage();
      drawSemanticTableHeader(headers, widths, ctx, headerHeight);
    }
    drawSemanticTableRow(row, headers, widths, rowHeight, ctx, index, options.priorityAware);
  });
  ctx.doc.x = x;
  ctx.doc.moveDown(0.8);
}

function drawSemanticTableHeader(headers: string[], widths: number[], ctx: NativePdfContext, height: number): void {
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  ctx.doc.roundedRect(x, y, tableWidth, height, 3).fill("#1D2A44");
  let cursor = x;
  headers.forEach((header, index) => {
    const cellWidth = widths[index] ?? 0;
    ctx.doc.font(fontName(ctx, "bold")).fontSize(7.8).fillColor("#FFFFFF").text(header, cursor + 6, y + 8, {
      width: cellWidth - 12,
      lineBreak: false
    });
    cursor += cellWidth;
  });
  ctx.doc.y = y + height;
}

function drawSemanticTableRow(
  row: string[],
  headers: string[],
  widths: number[],
  height: number,
  ctx: NativePdfContext,
  rowIndex: number,
  priorityAware: boolean
): void {
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  let cursor = x;
  row.forEach((cell, index) => {
    const width = widths[index] ?? 0;
    const header = (headers[index] ?? "").toLowerCase();
    const palette = priorityAware && /(prioridad|estado)/.test(header) ? tonePalette(cell) : undefined;
    const fill = palette?.fill ?? (rowIndex % 2 === 0 ? "#FFFFFF" : "#F7F4EE");
    ctx.doc.rect(cursor, y, width, height).fillAndStroke(fill, "#D7D0C4");
    ctx.doc.font(fontName(ctx, index === 0 ? "bold" : "body")).fontSize(8).fillColor("#111827").text(cell, cursor + 6, y + 7, {
      width: width - 12,
      lineGap: 1
    });
    cursor += width;
  });
  ctx.doc.y = y + height;
}

function semanticRowHeight(row: string[], widths: number[], ctx: NativePdfContext, compact: boolean): number {
  const fontSize = compact ? 7.4 : 8;
  ctx.doc.font(fontName(ctx, "body")).fontSize(fontSize);
  return Math.max(compact ? 22 : 30, ...row.map((cell, index) =>
    ctx.doc.heightOfString(cell, { width: Math.max(1, (widths[index] ?? 0) - 12), lineGap: 1 }) + 14
  ));
}

function semanticColumnWidths(headers: string[], rows: string[][], ctx: NativePdfContext): number[] {
  const width = contentWidth(ctx);
  const weights = headers.map((header, columnIndex) => {
    const samples = [header, ...rows.map((row) => row[columnIndex] ?? "")].filter(Boolean);
    const longest = Math.max(8, ...samples.map((sample) => Math.min(42, sample.length)));
    const normalized = header.toLowerCase();
    if (/(accion|acción|seguimiento|descripcion|descripción)/.test(normalized)) return longest * 1.45;
    if (/(prioridad|impacto|estado)/.test(normalized)) return longest * 0.86;
    return longest;
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const minWidth = Math.min(54, width / headers.length);
  const flexible = Math.max(0, width - minWidth * headers.length);
  return weights.map((weight) => minWidth + flexible * (weight / total));
}

function renderArticleAbstract(children: BlockNode[], ctx: NativePdfContext): void {
  const text = children.map((child) => blockText(child, ctx)).filter(Boolean).join("\n\n");
  const width = contentWidth(ctx) * 0.66;
  ctx.doc.font(fontName(ctx, "serif")).fontSize(11);
  const bodyHeight = ctx.doc.heightOfString(`Abstract. ${text}`, { width, lineGap: 2 });
  ensureSpace(ctx, bodyHeight + 18);
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  ctx.doc.font(fontName(ctx, "serifBold")).fontSize(11).fillColor("#111111").text("Abstract. ", x, y, {
    width,
    continued: true,
    lineGap: 2
  });
  ctx.doc.font(fontName(ctx, "serif")).fontSize(11).fillColor("#111111").text(text, {
    width,
    lineGap: 2
  });
  ctx.doc.x = x;
  ctx.doc.y = y + bodyHeight + 24;
}

function renderTableBodyRow(
  row: TableRowLayout,
  header: TableRowLayout,
  widths: number[],
  ctx: NativePdfContext,
  style: TableStyle,
  rowIndex: number
): void {
  if (row.height <= maxTableBodyHeightOnFreshPage(ctx, header)) {
    if (!hasSpace(ctx, row.height)) {
      addTableContinuationPage(ctx, header, widths, style);
    }
    drawTableRow(row, widths, ctx, style, rowIndex % 2 === 1);
    return;
  }

  let lineOffset = 0;
  while (lineOffset < row.lineCount) {
    if (!hasSpace(ctx, style.minRowHeight)) {
      addTableContinuationPage(ctx, header, widths, style);
    }

    let maxLines = maxTableLinesForCurrentPage(ctx, style, false);
    if (maxLines < 1) {
      addTableContinuationPage(ctx, header, widths, style);
      maxLines = maxTableLinesForCurrentPage(ctx, style, false);
    }

    const linesToRender = Math.max(1, Math.min(row.lineCount - lineOffset, maxLines));
    const segment = sliceTableRow(row, lineOffset, linesToRender, style);
    if (!hasSpace(ctx, segment.height)) {
      addTableContinuationPage(ctx, header, widths, style);
      continue;
    }

    drawTableRow(segment, widths, ctx, style, rowIndex % 2 === 1);
    lineOffset += linesToRender;

    if (lineOffset < row.lineCount) {
      addTableContinuationPage(ctx, header, widths, style);
    }
  }
}

function drawTableRow(row: TableRowLayout, widths: number[], ctx: NativePdfContext, style: TableStyle, zebra = false): void {
  const startX = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  let x = startX;
  const fill = row.header ? style.headerFill : zebra ? style.zebraFill : "#FFFFFF";
  if (style.ruleMode === "booktabs") {
    const tableWidth = widths.reduce((sum, width) => sum + width, 0);
    if (row.header) ctx.doc.moveTo(startX, y).lineTo(startX + tableWidth, y).lineWidth(0.8).stroke(style.borderColor);
    row.cells.forEach((cell, index) => {
      const width = widths[index] ?? 0;
      drawTableCellText(cell, x, y, width, row, ctx, style);
      x += width;
    });
    ctx.doc.moveTo(startX, y + row.height).lineTo(startX + tableWidth, y + row.height).lineWidth(row.header ? 0.8 : 0.45).stroke(style.borderColor);
    ctx.doc.x = startX;
    ctx.doc.y = y + row.height;
    return;
  }
  row.cells.forEach((cell, index) => {
    const width = widths[index] ?? 0;
    ctx.doc.rect(x, y, width, row.height).fillAndStroke(fill, style.borderColor);
    drawTableCellText(cell, x, y, width, row, ctx, style);
    x += width;
  });
  ctx.doc.x = startX;
  ctx.doc.y = y + row.height;
}

function drawTableCellText(
  cell: TableCellLayout,
  x: number,
  y: number,
  width: number,
  row: TableRowLayout,
  ctx: NativePdfContext,
  style: TableStyle
): void {
  const font = fontName(ctx, row.header ? "bold" : "body");
  const fontSize = row.header ? style.headerFontSize : style.fontSize;
  const lineHeight = tableLineHeight(style, row.header);
  ctx.doc.font(font).fontSize(fontSize).fillColor("#111111");
  cell.lines.forEach((line, index) => {
    ctx.doc.text(line, x + style.paddingX, y + style.paddingY + index * lineHeight, {
      width: Math.max(1, width - style.paddingX * 2),
      align: cell.align,
      lineBreak: false
    });
  });
}

async function renderBibliography(ctx: NativePdfContext): Promise<void> {
  const bibFiles = normalizeBibFiles(ctx.document.frontmatter?.data.bib);
  ctx.doc.addPage();
  ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#111111").text("Bibliografía").moveDown(0.8);
  if (bibFiles.length === 0) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(10).text("No se declaró archivo bibliográfico.");
    return;
  }
  for (const bibFile of bibFiles) {
    const file = resolveSourcePath(bibFile, ctx);
    try {
      const content = await readFile(file, "utf8");
      for (const entry of parseBibEntries(content)) {
        ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#222222").text(entry, { indent: 18, lineGap: 2 });
        ctx.doc.moveDown(0.4);
      }
    } catch {
      ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#9A3412").text(`No se pudo leer ${bibFile}`);
    }
  }
}

function renderPageNumbers(ctx: NativePdfContext): void {
  const range = ctx.doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    ctx.doc.switchToPage(index);
    if (ctx.template.id === "informe-operativo") {
      renderOperationalHeaderFooter(ctx, index);
      continue;
    }
    if (ctx.template.id === "article-digital-economy") {
      renderArticleHeaderFooter(ctx, index);
      continue;
    }
    const originalBottomMargin = ctx.doc.page.margins.bottom;
    ctx.doc.page.margins.bottom = 0;
    ctx.doc
      .font(fontName(ctx, "body"))
      .fontSize(9)
      .fillColor("#666666")
      .text(String(index + 1), 0, ctx.doc.page.height - 42, { align: "center" });
    ctx.doc.page.margins.bottom = originalBottomMargin;
  }
}

function renderOperationalHeaderFooter(ctx: NativePdfContext, pageIndex: number): void {
  if (pageIndex === 0) return;
  const data = ctx.document.frontmatter?.data ?? {};
  const left = frontmatterText(data.organization) || "KUI";
  const right = String(data.headerRight ?? "Reporte operativo");
  const footerLeft = String(data.footerLeft ?? "Equipo de Operaciones");
  const footerRight = String(data.date ?? new Date().getFullYear());
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const top = 36;
  const footerY = ctx.doc.page.height - 35;
  const originalBottomMargin = ctx.doc.page.margins.bottom;
  ctx.doc.page.margins.bottom = 0;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor(ctx.template.defaultStyle.colors.secondary).text(left, x, top, { width: width / 2, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#667085").text(right, x + width / 2, top, { width: width / 2, align: "right", lineBreak: false });
  ctx.doc.moveTo(x, top + 18).lineTo(x + width, top + 18).lineWidth(0.8).stroke(ctx.template.defaultStyle.colors.secondary);
  ctx.doc.moveTo(x, footerY - 10).lineTo(x + width, footerY - 10).lineWidth(0.5).stroke("#CBD5E1");
  ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#667085").text(footerLeft, x, footerY, { width: width / 3, lineBreak: false });
  ctx.doc.text(`Pagina ${pageIndex + 1}`, x + width / 3, footerY, { width: width / 3, align: "center", lineBreak: false });
  ctx.doc.text(footerRight, x + width * 2 / 3, footerY, { width: width / 3, align: "right", lineBreak: false });
  ctx.doc.page.margins.bottom = originalBottomMargin;
}

function renderArticleHeaderFooter(ctx: NativePdfContext, pageIndex: number): void {
  if (pageIndex === 0) return;
  const data = ctx.document.frontmatter?.data ?? {};
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const header = String(data.runningHead ?? "DARIL YOVANI / DIGITAL ECONOMY");
  ctx.doc.font(fontName(ctx, "mono")).fontSize(8).fillColor("#111111").text(header, x, 40, { width: width / 2, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#111111").text(String(pageIndex + 1), x + width / 2, 40, { width: width / 2, align: "right", lineBreak: false });
  ctx.doc.moveTo(x, 52).lineTo(x + width, 52).lineWidth(0.6).stroke("#111111");
}

function renderTocPageNumbers(ctx: NativePdfContext): void {
  if (ctx.tocPlaceholders.length === 0) return;
  for (const placeholder of ctx.tocPlaceholders) {
    const heading = ctx.headings[placeholder.headingIndex];
    if (!heading?.page) continue;
    ctx.doc.switchToPage(placeholder.pageIndex);
    ctx.doc
      .font(fontName(ctx, "body"))
      .fontSize(10)
      .fillColor("#111111")
      .text(String(heading.page), placeholder.x, placeholder.y, {
        width: placeholder.width,
        align: "right",
        lineBreak: false
      });
  }
}

function nativePdfPageMap(ctx: NativePdfContext): NativePdfPageMap {
  return {
    headings: ctx.headings.map((heading) => ({ ...heading })),
    labels: Object.fromEntries([...ctx.labels.entries()].map(([id, info]) => [id, { ...info }])),
    footnotes: [...ctx.footnoteNumbers.entries()].map(([id, number]) => ({
      id,
      number,
      page: (ctx.footnotePages.get(id) ?? 0) + 1
    }))
  };
}

function renderFootnotes(ctx: NativePdfContext): void {
  if (ctx.pageFootnotes.size === 0) return;
  const pages = [...ctx.pageFootnotes.keys()].sort((a, b) => a - b);
  for (const pageIndex of pages) {
    const notes = ctx.pageFootnotes.get(pageIndex) ?? [];
    if (notes.length === 0) continue;
    ctx.doc.switchToPage(pageIndex);
    const reserve = ctx.pageFootnoteReserves.get(pageIndex) ?? estimateFootnoteItemsHeight(notes, ctx);
    const x = ctx.doc.page.margins.left;
    const width = contentWidth(ctx);
    const y = ctx.doc.page.height - ctx.doc.page.margins.bottom - reserve + 7;
    ctx.doc.moveTo(x, y).lineTo(x + width * 0.32, y).lineWidth(0.45).stroke("#9CA3AF");
    let cursorY = y + 5;
    for (const note of notes) {
      const text = `${note.number}. ${note.text}`;
      ctx.doc.font(fontName(ctx, "body")).fontSize(7.6).fillColor("#374151").text(text, x, cursorY, {
        width,
        lineGap: 0.6
      });
      cursorY += ctx.doc.heightOfString(text, { width, lineGap: 0.6 }) + 2;
    }
  }
}

function inlineText(nodes: InlineNode[], ctx?: NativePdfContext): string {
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
        return citationText(node);
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

function consumeInlineFootnotes(ctx: NativePdfContext): string[] {
  const refs = [...new Set(ctx.currentInlineFootnotes)];
  ctx.currentInlineFootnotes = [];
  return refs;
}

function blockText(block: BlockNode, ctx?: NativePdfContext): string {
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

function semanticTitle(block: FencedDivNode, fallback: string): string {
  return safePdfText(block.attrs?.normalized.title ?? block.attrs?.kv.title ?? fallback);
}

function semanticItemsFromChildren(children: BlockNode[], ctx: NativePdfContext): SemanticItem[] {
  const lines = semanticLinesFromChildren(children, ctx);
  return lines.map(splitSemanticItem).filter((item) => item.label || item.value);
}

function semanticLinesFromChildren(children: BlockNode[], ctx: NativePdfContext): string[] {
  const lines: string[] = [];
  for (const child of children) {
    if (child.kind === "List") {
      child.items.forEach((item) => lines.push(inlineText(item.children, ctx)));
      continue;
    }
    if (child.kind === "Paragraph" || child.kind === "FootnoteDef") {
      inlineText(child.children, ctx).split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => lines.push(line));
      continue;
    }
    if (child.kind === "FencedDiv" || child.kind === "Blockquote" || child.kind === "Callout") {
      lines.push(...semanticLinesFromChildren(child.children, ctx));
      continue;
    }
  }
  return lines;
}

function splitSemanticItem(raw: string): SemanticItem {
  const text = raw.replace(/^[-*+]\s+/, "").trim();
  const pipeParts = text.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    const first = splitSemanticItem(pipeParts[0]);
    return { label: first.label, value: first.value, detail: pipeParts.slice(1).join(" | ") };
  }

  const colon = text.match(/^([^:]{2,48}):\s*(.+)$/);
  if (colon) return { label: colon[1].trim(), value: colon[2].trim() };

  const dash = text.match(/^(.{2,48}?)\s+(?:-|->)\s+(.+)$/);
  if (dash) return { label: dash[1].trim(), value: dash[2].trim() };

  const leadingValue = text.match(/^([A-Za-z$S/.]*\s?\d[\d,.%/]*)\s+(.+)$/);
  if (leadingValue) return { value: leadingValue[1].trim(), label: leadingValue[2].trim() };

  return { label: text, value: "" };
}

function firstTable(children: BlockNode[]): TableNode | undefined {
  for (const child of children) {
    if (child.kind === "Table") return child;
    if (child.kind === "FencedDiv" || child.kind === "Blockquote" || child.kind === "Callout") {
      const nested = firstTable(child.children);
      if (nested) return nested;
    }
  }
  return undefined;
}

function tonePalette(value: string): { fill: string; stroke: string } {
  const text = value.toLowerCase();
  if (/cr[ií]tica|alto|alta|bloque|vencid|urgente|rojo/.test(text)) return { fill: "#FEF2F2", stroke: "#DC2626" };
  if (/medio|media|observaci[oó]n|pendiente|amarillo/.test(text)) return { fill: "#FFFBEB", stroke: "#D97706" };
  if (/bajo|baja|cerrad|concluid|emitid|verde|ok|complet/.test(text)) return { fill: "#ECFDF3", stroke: "#16A34A" };
  if (/seguimiento|calificaci[oó]n|azul/.test(text)) return { fill: "#EFF6FF", stroke: "#2563EB" };
  return { fill: "#F8FAFC", stroke: "#64748B" };
}

function collectHeadings(blocks: BlockNode[]): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const visit = (block: BlockNode): void => {
    if (block.kind === "Heading") headings.push({ level: block.level, title: inlineText(block.title), id: block.attrs?.id });
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return headings;
}

function drawRule(ctx: NativePdfContext): void {
  const x = ctx.doc.x;
  const y = ctx.doc.y;
  ctx.doc.moveTo(x, y).lineTo(ctx.doc.page.width - ctx.doc.page.margins.right, y).stroke("#AAAAAA");
  ctx.doc.moveDown(1);
}

function tableColumnCount(block: TableNode): number {
  return Math.max(1, block.headers.length, ...block.rows.map((row) => row.length));
}

function tableStyle(columnCount: number, ctx: NativePdfContext): TableStyle {
  const compacting = Math.max(0, columnCount - 4);
  if (ctx.template.id === "informe-operativo") {
    return {
      borderColor: "#DED8CE",
      headerFill: "#EEEAE2",
      zebraFill: "#F6F3ED",
      ruleMode: "grid",
      fontSize: Math.max(5.8, 6.8 - compacting * 0.18),
      headerFontSize: Math.max(6.0, 7.0 - compacting * 0.18),
      paddingX: 2.7,
      paddingY: 2.2,
      lineGap: 0.2,
      minRowHeight: 12
    };
  }
  if (ctx.template.id === "article-digital-economy") {
    return {
      borderColor: "#111111",
      headerFill: "#FFFFFF",
      zebraFill: "#FFFFFF",
      ruleMode: "booktabs",
      fontSize: Math.max(6.4, 8.2 - compacting * 0.28),
      headerFontSize: Math.max(6.7, 8.2 - compacting * 0.28),
      paddingX: columnCount > 5 ? 3.6 : 4.5,
      paddingY: 3.5,
      lineGap: 0.8,
      minRowHeight: 18
    };
  }
  return {
    borderColor: "#D1D5DB",
    headerFill: "#EEF2F7",
    zebraFill: "#F9FAFB",
    ruleMode: "grid",
    fontSize: Math.max(7.2, 8.8 - compacting * 0.25),
    headerFontSize: Math.max(7.4, 8.8 - compacting * 0.25),
    paddingX: columnCount > 5 ? 4 : 5,
    paddingY: 5,
    lineGap: 1.3,
    minRowHeight: 24
  };
}

function normalizeTableRow(row: InlineNode[][], columnCount: number): InlineNode[][] {
  return Array.from({ length: columnCount }, (_unused, index) => row[index] ?? []);
}

function normalizeTableAlignments(alignments: TableNode["alignments"], columnCount: number): Array<"left" | "center" | "right"> {
  return Array.from({ length: columnCount }, (_unused, index) => alignments?.[index] ?? "left");
}

function columnWidths(block: TableNode, columnCount: number, ctx: NativePdfContext, style: TableStyle): number[] {
  const totalWidth = contentWidth(ctx);
  const minWidth = Math.min(58, totalWidth / columnCount);
  if (minWidth * columnCount > totalWidth) {
    return Array.from({ length: columnCount }, () => totalWidth / columnCount);
  }

  const weights = Array.from({ length: columnCount }, (_unused, columnIndex) => {
    const samples = [block.headers, ...block.rows]
      .map((row) => inlineText(row[columnIndex] ?? [], ctx).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const longest = Math.max(8, ...samples.map((sample) => Math.min(44, sample.length)));
    return longest;
  });
  const availableForWeights = totalWidth - minWidth * columnCount;
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => minWidth + availableForWeights * (weight / weightTotal));
}

function layoutTableRow(
  row: InlineNode[][],
  widths: number[],
  ctx: NativePdfContext,
  header: boolean,
  style: TableStyle,
  alignments: Array<"left" | "center" | "right">
): TableRowLayout {
  const font = fontName(ctx, header ? "bold" : "body");
  const fontSize = header ? style.headerFontSize : style.fontSize;
  const cells = row.map((cell, index) => {
    const text = inlineText(cell, ctx).replace(/[ \t]+/g, " ").trim();
    return {
      text,
      align: alignments[index] ?? "left",
      lines: wrapTableCellText(text, Math.max(1, widths[index] - style.paddingX * 2), ctx, font, fontSize)
    };
  });
  const lineCount = Math.max(1, ...cells.map((cell) => cell.lines.length));
  return {
    cells,
    height: tableRowHeight(lineCount, style, header),
    lineCount,
    header
  };
}

function sliceTableRow(row: TableRowLayout, lineOffset: number, lineCount: number, style: TableStyle): TableRowLayout {
  const cells = row.cells.map((cell) => ({
    text: cell.text,
    align: cell.align,
    lines: cell.lines.slice(lineOffset, lineOffset + lineCount)
  }));
  const renderedLineCount = Math.max(1, ...cells.map((cell) => cell.lines.length));
  return {
    cells,
    height: tableRowHeight(renderedLineCount, style, row.header),
    lineCount: renderedLineCount,
    header: row.header
  };
}

function wrapTableCellText(text: string, width: number, ctx: NativePdfContext, font: string, fontSize: number): string[] {
  ctx.doc.font(font).fontSize(fontSize);
  const lines: string[] = [];
  const paragraphs = (text || "").split(/\n/);
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      for (const part of breakLongTableWord(word, width, ctx)) {
        if (!line) {
          line = part;
          continue;
        }
        const candidate = `${line} ${part}`;
        if (ctx.doc.widthOfString(candidate) <= width) {
          line = candidate;
        } else {
          lines.push(line);
          line = part;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

function breakLongTableWord(word: string, width: number, ctx: NativePdfContext): string[] {
  if (ctx.doc.widthOfString(word) <= width) return [word];
  const parts: string[] = [];
  let part = "";
  for (const char of [...word]) {
    const candidate = `${part}${char}`;
    if (!part || ctx.doc.widthOfString(candidate) <= width) {
      part = candidate;
    } else {
      parts.push(part);
      part = char;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function tableLineHeight(style: TableStyle, header: boolean): number {
  return (header ? style.headerFontSize : style.fontSize) + style.lineGap + 1;
}

function tableRowHeight(lineCount: number, style: TableStyle, header: boolean): number {
  return Math.max(style.minRowHeight, lineCount * tableLineHeight(style, header) + style.paddingY * 2);
}

function maxTableLinesForCurrentPage(ctx: NativePdfContext, style: TableStyle, header: boolean): number {
  return Math.floor(Math.max(0, availableContentHeight(ctx) - style.paddingY * 2) / tableLineHeight(style, header));
}

function addTableContinuationPage(ctx: NativePdfContext, header: TableRowLayout, widths: number[], style: TableStyle): void {
  ctx.doc.addPage();
  ctx.doc.x = ctx.doc.page.margins.left;
  drawTableRow(header, widths, ctx, style);
}

function maxTableBodyHeightOnFreshPage(ctx: NativePdfContext, header: TableRowLayout): number {
  return ctx.doc.page.height - ctx.doc.page.margins.top - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx) - header.height;
}

function authorText(author: unknown): string {
  if (Array.isArray(author)) {
    return author.map((item) => typeof item === "string" ? item : String((item as Record<string, unknown>).name ?? "")).join(", ");
  }
  return typeof author === "string" ? author : "";
}

function frontmatterText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(frontmatterText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return safePdfText(String(record.value ?? record.name ?? record.label ?? ""));
  }
  return safePdfText(String(value));
}

function frontmatterPairs(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const label = frontmatterText(record.label);
    const text = frontmatterText(record.value);
    return label || text ? [{ label, value: text }] : [];
  });
}

function frontmatterList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(frontmatterText).filter(Boolean);
  const text = frontmatterText(value);
  return text ? [text] : [];
}

function citationText(node: CitationNode): string {
  const keys = node.items.map((item) => item.locator ? `${item.key}, ${item.locator}` : item.key).join("; ");
  return node.citationStyle === "intext" ? keys : `(${keys})`;
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

function currentPageIndex(ctx: NativePdfContext): number {
  const range = ctx.doc.bufferedPageRange();
  return range.start + range.count - 1;
}

function currentPageNumber(ctx: NativePdfContext): number {
  return currentPageIndex(ctx) + 1;
}

function markLabelPage(ctx: NativePdfContext, id: string | undefined): void {
  if (!id) return;
  const info = ctx.labels.get(id);
  if (info) info.page = currentPageNumber(ctx);
}

function markHeadingPage(ctx: NativePdfContext, block: HeadingNode): void {
  const heading = ctx.headings[ctx.headingRenderIndex];
  const page = currentPageNumber(ctx);
  if (heading) heading.page = page;
  markLabelPage(ctx, block.attrs?.id);
  ctx.headingRenderIndex += 1;
}

function registerFootnotesOnCurrentPage(refs: string[], ctx: NativePdfContext): void {
  const pageIndex = currentPageIndex(ctx);
  const existing = ctx.pageFootnotes.get(pageIndex) ?? [];
  let changed = false;
  for (const id of refs) {
    if (ctx.footnotePages.has(id)) continue;
    const number = ctx.footnoteNumbers.get(id) ?? ctx.footnoteNumbers.size + 1;
    ctx.footnoteNumbers.set(id, number);
    ctx.footnotePages.set(id, pageIndex);
    existing.push({ id, number, text: ctx.footnotes.get(id) ?? `Nota sin definición: ${id}` });
    changed = true;
  }
  if (!changed) return;
  existing.sort((a, b) => a.number - b.number);
  ctx.pageFootnotes.set(pageIndex, existing);
  ctx.pageFootnoteReserves.set(pageIndex, estimateFootnoteItemsHeight(existing, ctx));
}

function estimateNewFootnotesHeight(refs: string[], ctx: NativePdfContext): number {
  const unique = refs.filter((id, index) => refs.indexOf(id) === index && !ctx.footnotePages.has(id));
  if (unique.length === 0) return 0;
  const items = unique.map((id) => ({
    id,
    number: ctx.footnoteNumbers.get(id) ?? ctx.footnoteNumbers.size + 1,
    text: ctx.footnotes.get(id) ?? `Nota sin definición: ${id}`
  }));
  return estimateFootnoteItemsHeight(items, ctx);
}

function estimateFootnoteItemsHeight(items: PageFootnote[], ctx: NativePdfContext): number {
  if (items.length === 0) return 0;
  const width = contentWidth(ctx);
  ctx.doc.font(fontName(ctx, "body")).fontSize(7.6);
  const textHeight = items.reduce((sum, item) => {
    const text = `${item.number}. ${item.text}`;
    return sum + ctx.doc.heightOfString(text, { width, lineGap: 0.6 }) + 2;
  }, 0);
  return Math.min(ctx.doc.page.height * 0.28, Math.max(22, textHeight + 12));
}

function collectLabels(blocks: BlockNode[]): Map<string, LabelInfo> {
  const labels = new Map<string, LabelInfo>();
  const counters = { sec: [0, 0, 0, 0, 0, 0], fig: 0, tbl: 0, eq: 0, thm: 0, def: 0, lem: 0, cor: 0 };
  const visit = (block: BlockNode): void => {
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
      counters.tbl += 1;
      if (block.attrs?.id) labels.set(block.attrs.id, { type: "tbl", number: String(counters.tbl) });
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

function collectFootnotes(blocks: BlockNode[]): Map<string, string> {
  const footnotes = new Map<string, string>();
  const visit = (block: BlockNode): void => {
    if (block.kind === "FootnoteDef") footnotes.set(block.id, inlineText(block.children));
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return footnotes;
}

function ensureSpace(ctx: NativePdfContext, needed: number): void {
  const bottom = ctx.doc.page.height - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx);
  if (ctx.doc.y + needed > bottom) ctx.doc.addPage();
}

function hasSpace(ctx: NativePdfContext, needed: number): boolean {
  return ctx.doc.y + needed <= ctx.doc.page.height - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx);
}

function availableContentHeight(ctx: NativePdfContext): number {
  return ctx.doc.page.height - ctx.doc.page.margins.bottom - reservedFootnoteHeight(ctx) - ctx.doc.y;
}

function contentWidth(ctx: NativePdfContext): number {
  return ctx.doc.page.width - ctx.doc.page.margins.left - ctx.doc.page.margins.right;
}

function reservedFootnoteHeight(ctx: NativePdfContext): number {
  return ctx.pageFootnoteReserves.get(currentPageIndex(ctx)) ?? 0;
}

function formatMath(content: string): string {
  return safePdfText(content
    .trim()
    .replace(/\\rho/g, "ρ")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\_/g, "_")
    .replace(/[{}]/g, ""));
}

function safePdfText(value: string): string {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/≈/g, "~")
    .replace(/×/g, "x")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/ρ/g, "rho");
}

function resolveNodePath(rawPath: string, node: { position?: { file?: string } }, ctx: NativePdfContext): string {
  if (/^https?:\/\//.test(rawPath) || path.isAbsolute(rawPath)) return rawPath;
  if (!node.position?.file) return path.resolve(ctx.options.cwd, rawPath);
  return path.resolve(path.dirname(node.position.file), rawPath);
}

function resolveSourcePath(rawPath: string, ctx: NativePdfContext): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  const sourceFile = ctx.document.sourceFiles[0];
  return sourceFile ? path.resolve(path.dirname(sourceFile), rawPath) : path.resolve(ctx.options.cwd, rawPath);
}

function normalizeBibFiles(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function parseBibEntries(content: string): string[] {
  const entries: string[] = [];
  const entryPattern = /@\w+\s*\{\s*([^,]+),([\s\S]*?)\n\}/g;
  for (const match of content.matchAll(entryPattern)) {
    const fields = parseBibFields(match[2]);
    const author = fields.author ?? match[1];
    const year = fields.year ? ` (${fields.year}).` : ".";
    const title = fields.title ? ` ${fields.title}.` : "";
    const container = fields.journal ?? fields.publisher ?? "";
    entries.push(`${author}${year}${title}${container ? ` ${container}.` : ""}`);
  }
  return entries.length > 0 ? entries : [content.trim()];
}

function parseBibFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const fieldPattern = /(\w+)\s*=\s*[{"]([^}"]+)[}"]/g;
  for (const match of body.matchAll(fieldPattern)) fields[match[1].toLowerCase()] = match[2];
  return fields;
}
