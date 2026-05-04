import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import type {
  BlockNode,
  CitationNode,
  CrossRefNode,
  DirectiveNode,
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
import { formatReferenceEntry, normalizeReferenceSources, parseReferenceContent, type KuiReferenceEntry } from "../semantic/bibliography.js";
import { resolveTemplate, type TemplateManifest } from "../templates/registry.js";
import { resolveAssetPath } from "../utils/asset-resolver.js";

export interface NativePdfOutput {
  pdfPath: string;
  pdfBytes: Uint8Array;
  diagnostics: Diagnostic[];
  sourceFiles: string[];
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
  fontSize?: number;
  linkX: number;
  linkY: number;
  linkWidth: number;
  linkHeight: number;
  destination: string;
}

interface ListPlaceholder {
  labelId: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  fontSize?: number;
  linkX: number;
  linkY: number;
  linkWidth: number;
  linkHeight: number;
  destination: string;
}

interface IndexEntryRow {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  linkX: number;
  linkY: number;
  linkWidth: number;
  linkHeight: number;
}

interface ListedNodeInfo {
  labelId: string;
  title: string;
}

interface PageNumberingSegment {
  pageIndex: number;
  style: "arabic" | "roman";
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
  listPlaceholders: ListPlaceholder[];
  pageNumberingSegments: PageNumberingSegment[];
  footnotes: Map<string, string>;
  footnoteNumbers: Map<string, number>;
  footnotePages: Map<string, number>;
  pageFootnotes: Map<number, PageFootnote[]>;
  pageFootnoteReserves: Map<number, number>;
  currentInlineFootnotes: string[];
  registeredDestinations: Set<string>;
  references: Map<string, KuiReferenceEntry>;
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

interface CoordinatePoint {
  label: string;
  x: number;
  y: number;
}

interface InlineSegment {
  text: string;
  role: FontRole;
  color: string;
}

interface InlineStyle {
  role: FontRole;
  color: string;
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
  const registeredFonts = registerDocumentFonts(doc, document.frontmatter?.data, options, document.sourceFiles[0]);
  const fonts = template.id === "tesis-unsaac"
    ? {
        ...registeredFonts,
        body: registeredFonts.serif,
        bold: registeredFonts.serifBold,
        italic: registeredFonts.serifItalic,
        boldItalic: registeredFonts.serifBold
      }
    : registeredFonts;

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
    listPlaceholders: [],
    pageNumberingSegments: [],
    footnotes: collectFootnotes(document.children),
    footnoteNumbers: new Map(),
    footnotePages: new Map(),
    pageFootnotes: new Map(),
    pageFootnoteReserves: new Map(),
    currentInlineFootnotes: [],
    registeredDestinations: new Set(),
    references: new Map()
  };

  ctx.references = await loadReferenceEntries(ctx);
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
  return {
    pdfPath,
    pdfBytes: new Uint8Array(bytes),
    diagnostics: ctx.diagnostics,
    sourceFiles: document.sourceFiles,
    pageMap: nativePdfPageMap(ctx)
  };
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
  if (ctx.template.id === "plano-tecnico") return;
  if (ctx.template.id === "brochure-visual") {
    renderBrochureCover(ctx);
    return;
  }
  if (ctx.template.id === "informe-operativo") {
    renderOperationalCover(ctx);
    return;
  }
  if (ctx.template.id === "article-digital-economy") {
    renderArticleTitle(ctx);
    return;
  }
  if (ctx.template.id === "tesis-unsaac") {
    renderUnsaacCover(ctx);
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

function renderUnsaacCover(ctx: NativePdfContext): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const pageWidth = ctx.doc.page.width;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const title = frontmatterText(data.title) || "TÍTULO DE LA TESIS";
  const authors = frontmatterList(data.author);
  const asesor = frontmatterText(data.asesor);
  const coasesor = frontmatterText(data.coasesor);
  const degree = frontmatterText(data.academicDegree);
  const faculty = frontmatterText(data.facultad).toUpperCase();
  const school = frontmatterText(data.school).toUpperCase();
  const institution = (frontmatterText(data.institucion) || "Universidad Nacional de San Antonio Abad del Cusco").toUpperCase();
  const date = frontmatterText(data.date) || String(new Date().getFullYear());

  ctx.doc.font(fontName(ctx, "bold")).fontSize(14).fillColor("#111111");
  ctx.doc.text(institution, x, 66, { width, align: "center" });
  ctx.doc.text(`FACULTAD DE ${faculty}`, x, ctx.doc.y + 4, { width, align: "center" });
  ctx.doc.text(`ESCUELA PROFESIONAL DE ${school}`, x, ctx.doc.y + 4, { width, align: "center" });

  drawUnsaacSeal(ctx, pageWidth / 2, 168);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(13).text("TESIS", x, 238, { width, align: "center" });

  const boxY = 270;
  const boxHeight = 138;
  ctx.doc.roundedRect(x + 18, boxY, width - 36, boxHeight, 4).lineWidth(2.4).stroke("#111111");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(12).text(title.toUpperCase(), x + 38, boxY + 22, {
    width: width - 76,
    align: "center",
    lineGap: 2
  });

  const infoX = x + 86;
  const infoY = 442;
  const infoWidth = width - 150;
  let cursor = infoY;
  const writeLabel = (label: string, value: string): void => {
    if (!value.trim()) return;
    ctx.doc.font(fontName(ctx, "bold")).fontSize(11).text(label, infoX, cursor, { width: infoWidth });
    cursor = ctx.doc.y + 2;
    ctx.doc.font(fontName(ctx, "body")).fontSize(11).text(value, infoX, cursor, { width: infoWidth, lineGap: 1 });
    cursor = ctx.doc.y + 12;
  };

  writeLabel("PRESENTADO POR:", authors.join("\n"));
  writeLabel("PARA OPTAR AL TÍTULO PROFESIONAL", degree ? `DE ${degree.toUpperCase()}` : "");
  writeLabel("ASESOR:", asesor);
  writeLabel("CO-ASESOR:", coasesor);

  ctx.doc.font(fontName(ctx, "bold")).fontSize(13).text("CUSCO - PERÚ", x, 724, { width, align: "center" });
  ctx.doc.text(date, x, 754, { width, align: "center" });
  ctx.doc.addPage();
  ctx.doc.x = ctx.doc.page.margins.left;
  ctx.doc.y = ctx.doc.page.margins.top;
}

function drawUnsaacSeal(ctx: NativePdfContext, centerX: number, centerY: number): void {
  ctx.doc.circle(centerX, centerY, 38).lineWidth(1.4).stroke("#111111");
  ctx.doc.circle(centerX, centerY, 30).lineWidth(0.8).stroke("#111111");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(12).fillColor("#111111").text("UNSAAC", centerX - 34, centerY - 7, {
    width: 68,
    align: "center",
    lineBreak: false
  });
}

function renderBrochureCover(ctx: NativePdfContext): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const pageWidth = ctx.doc.page.width;
  const pageHeight = ctx.doc.page.height;
  const colors = ctx.template.defaultStyle.colors;
  const from = frontmatterText(data.gradientFrom ?? data.from) || colors.primary;
  const to = frontmatterText(data.gradientTo ?? data.to) || colors.secondary;
  const accent = frontmatterText(data.accent) || colors.accent;
  const image = frontmatterText(data.coverImage ?? data.heroImage ?? data.image);

  drawLinearGradient(ctx, 0, 0, pageWidth, pageHeight, from, to);
  drawSoftCircle(ctx, pageWidth - 110, 108, 220, accent, 0.2);
  drawSoftCircle(ctx, 92, pageHeight - 88, 190, "#F97316", 0.16);
  drawSoftCircle(ctx, pageWidth * 0.54, pageHeight * 0.52, 320, "#FFFFFF", 0.08);

  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const title = String(data.title ?? "Brochure KUI");
  const subtitle = String(data.subtitle ?? "");
  const organization = frontmatterText(data.organization ?? data.organizacion) || authorText(data.author);
  const tagline = frontmatterText(data.tagline ?? data.slogan) || "PDF nativo con lenguaje de documentos";

  ctx.doc
    .font(fontName(ctx, "bold"))
    .fontSize(10)
    .fillColor(accent)
    .text(tagline.toUpperCase(), x, 112, { width, characterSpacing: 0.8 });
  ctx.doc
    .font(fontName(ctx, "serifBold"))
    .fontSize(42)
    .fillColor("#FFFFFF")
    .text(title, x, 142, { width: width * 0.68, lineGap: 1 });
  ctx.doc
    .font(fontName(ctx, "body"))
    .fontSize(13)
    .fillColor("#E0F2FE")
    .text(subtitle, x, 268, { width: width * 0.54, lineGap: 3 });

  const imageBoxX = x + width * 0.64;
  const imageBoxY = 150;
  const imageBox = 160;
  ctx.doc.save().fillOpacity(0.16).roundedRect(imageBoxX - 16, imageBoxY - 16, imageBox + 32, imageBox + 32, 28).fill("#FFFFFF").restore();
  if (image) {
    try {
      const imagePath = resolveAssetPath(image, { cwd: ctx.options.cwd, sourceFile: ctx.document.sourceFiles[0] });
      ctx.doc.image(imagePath, imageBoxX, imageBoxY, { fit: [imageBox, imageBox], align: "center", valign: "center" });
    } catch {
      ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#FFFFFF").text("KUI", imageBoxX, imageBoxY + 60, {
        width: imageBox,
        align: "center"
      });
    }
  }

  renderBrochureCoverPills(ctx, x, pageHeight - 176, width);
  ctx.doc
    .font(fontName(ctx, "bold"))
    .fontSize(10)
    .fillColor("#FFFFFF")
    .text(organization, x, pageHeight - 108, { width: width * 0.62, lineBreak: false });
  ctx.doc
    .font(fontName(ctx, "body"))
    .fontSize(9)
    .fillColor("#BAE6FD")
    .text(String(data.date ?? new Date().getFullYear()), x, pageHeight - 90, { width: width * 0.62, lineBreak: false });

  ctx.doc.addPage();
  ctx.doc.x = ctx.doc.page.margins.left;
  ctx.doc.y = ctx.doc.page.margins.top;
}

function renderBrochureCoverPills(ctx: NativePdfContext, x: number, y: number, width: number): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const items = frontmatterPairs(data.metrics);
  const fallback = [
    { label: "PDF", value: "Nativo" },
    { label: "Diseño", value: "Difuminado" },
    { label: "Flujo", value: "Sin HTML" }
  ];
  const pills = (items.length > 0 ? items : fallback).slice(0, 3);
  const gap = 10;
  const pillWidth = (width - gap * (pills.length - 1)) / pills.length;
  pills.forEach((item, index) => {
    const pillX = x + index * (pillWidth + gap);
    ctx.doc.save().fillOpacity(0.14).roundedRect(pillX, y, pillWidth, 62, 14).fill("#FFFFFF").restore();
    ctx.doc.font(fontName(ctx, "bold")).fontSize(14).fillColor("#FFFFFF").text(item.value, pillX + 14, y + 13, {
      width: pillWidth - 28,
      lineBreak: false
    });
    ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#BAE6FD").text(item.label.toUpperCase(), pillX + 14, y + 38, {
      width: pillWidth - 28,
      lineBreak: false
    });
  });
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
      if (ctx.template.id === "tesis-unsaac") {
        renderAcademicBlockquote(block.children, ctx);
        return;
      }
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
      await renderDirective(block, ctx);
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
  const includeInToc = shouldIncludeInToc(block);
  const destination = includeInToc ? headingDestination(ctx.headingRenderIndex, ctx.headings[ctx.headingRenderIndex]) : undefined;
  if (ctx.template.id === "article-digital-economy" && level === 1) {
    renderArticleSectionHeading(number, rawTitle, ctx, destination);
    markHeadingPage(ctx, block, includeInToc);
    return;
  }
  if (ctx.template.id === "article-digital-economy") {
    renderArticlePlainHeading(rawTitle, level, ctx, destination);
    markHeadingPage(ctx, block, includeInToc);
    return;
  }
  if (ctx.template.id === "informe-operativo") {
    renderReportHeading(rawTitle, level, ctx, destination);
    markHeadingPage(ctx, block, includeInToc);
    return;
  }
  if (ctx.template.id === "tesis-unsaac") {
    renderUnsaacHeading(rawTitle, level, number, ctx, destination);
    markHeadingPage(ctx, block, includeInToc);
    return;
  }
  const title = `${number ? `${number} ` : ""}${rawTitle}`;
  const sizes = [18, 15, 13, 11, 10, 10];
  ensureSpace(ctx, sizes[level - 1] + 28);
  ctx.doc.moveDown(level === 1 ? 1 : 0.6);
  registerPdfDestination(ctx, destination);
  const displayedTitle = /^\d+(?:\.\d+)*\.?\s/.test(rawTitle) ? rawTitle : title;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(sizes[level - 1] ?? 11).fillColor("#111111").text(displayedTitle);
  ctx.doc.moveDown(0.35);
  markHeadingPage(ctx, block, includeInToc);
}

function renderUnsaacHeading(title: string, level: number, number: string, ctx: NativePdfContext, destination?: string): void {
  if (level === 1) {
    if (ctx.doc.y > ctx.doc.page.margins.top + 12) ctx.doc.addPage();
    const chapterNumber = toRoman(parseInt(number, 10) || ctx.headingCounters[0]);
    ctx.doc.moveDown(0.2);
    registerPdfDestination(ctx, destination);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(13).fillColor("#111111").text(`CAPÍTULO ${chapterNumber}`, {
      width: contentWidth(ctx),
      align: "center"
    });
    ctx.doc.moveDown(0.4);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(13).fillColor("#111111").text(title.toUpperCase(), {
      width: contentWidth(ctx),
      align: "center",
      lineGap: 1
    });
    ctx.doc.moveDown(0.9);
    return;
  }

  const sizes = [13, 12, 12, 11, 11, 11];
  ensureSpace(ctx, sizes[level - 1] + 28);
  ctx.doc.moveDown(level === 2 ? 0.7 : 0.45);
  registerPdfDestination(ctx, destination);
  const displayedTitle = /^\d+(?:\.\d+)*\.?\s/.test(title) ? title : `${number ? `${number} ` : ""}${title}`;
  ctx.doc.font(fontName(ctx, level === 3 ? "italic" : "bold")).fontSize(sizes[level - 1] ?? 11).fillColor("#111111").text(displayedTitle, {
    width: contentWidth(ctx),
    lineGap: 1
  });
  ctx.doc.moveDown(0.35);
}

function renderArticleSectionHeading(number: string, title: string, ctx: NativePdfContext, destination?: string): void {
  const textWidth = contentWidth(ctx) - 42;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(16);
  const titleHeight = ctx.doc.heightOfString(title, { width: textWidth });
  const blockHeight = Math.max(42, titleHeight + 18);
  ensureSpace(ctx, blockHeight + 12);
  ctx.doc.moveDown(1);
  registerPdfDestination(ctx, destination);
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  ctx.doc.rect(x, y + 2, 28, 22).fill("#111111");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#FFFFFF").text(number, x, y + 9, { width: 28, align: "center" });
  ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#111111").text(title, x + 42, y + 5, { width: textWidth });
  ctx.doc.x = x;
  ctx.doc.y = y + blockHeight;
}

function renderArticlePlainHeading(title: string, level: number, ctx: NativePdfContext, destination?: string): void {
  const sizes = [18, 15, 12, 10, 10, 10];
  const fontSize = sizes[level - 1] ?? 10;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(fontSize);
  const height = ctx.doc.heightOfString(title, { width: contentWidth(ctx), lineGap: 1 });
  ensureSpace(ctx, height + 24);
  ctx.doc.moveDown(level === 2 ? 0.85 : 0.55);
  registerPdfDestination(ctx, destination);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(fontSize).fillColor("#111111").text(title, {
    width: contentWidth(ctx),
    lineGap: 1
  });
  ctx.doc.moveDown(0.3);
}

function renderReportHeading(title: string, level: number, ctx: NativePdfContext, destination?: string): void {
  const sizes = [14, 12, 10, 10, 9, 9];
  ensureSpace(ctx, sizes[level - 1] + 28);
  ctx.doc.moveDown(level === 1 ? 1 : 0.6);
  registerPdfDestination(ctx, destination);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(sizes[level - 1] ?? 10).fillColor("#111111").text(title);
  ctx.doc.moveDown(0.35);
}

function renderParagraph(children: InlineNode[], ctx: NativePdfContext): void {
  const segments = captureInlineSegments(children, ctx, { role: "body", color: "#222222" });
  const text = segmentText(segments);
  if (ctx.template.id === "article-digital-economy") {
    renderArticleParagraph(segments, text, ctx);
    return;
  }
  const fontSize = ctx.template.id === "tesis-unsaac" ? 12 : 11;
  const lineGap = ctx.template.id === "tesis-unsaac" ? 4 : 2;
  const indent = ctx.template.id === "tesis-unsaac" ? 36 : undefined;
  const footnoteRefs = consumeInlineFootnotes(ctx);
  const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
  ensureSpace(ctx, ctx.doc.heightOfString(text, { width: contentWidth(ctx), align: "justify", lineGap, indent }) + 16 + footnoteHeight);
  registerFootnotesOnCurrentPage(footnoteRefs, ctx);
  renderInlineSegments(segments, ctx, { fontSize, color: "#222222", width: contentWidth(ctx), align: "justify", lineGap, indent });
  ctx.doc.moveDown(0.8);
}

function renderArticleParagraph(segments: InlineSegment[], text: string, ctx: NativePdfContext): void {
  ctx.doc.font(fontName(ctx, "serif")).fontSize(11);
  const footnoteRefs = consumeInlineFootnotes(ctx);
  const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
  ensureSpace(ctx, ctx.doc.heightOfString(text, { width: contentWidth(ctx), align: "left", lineGap: 2 }) + 12 + footnoteHeight);
  registerFootnotesOnCurrentPage(footnoteRefs, ctx);
  renderInlineSegments(segments.map((segment) => ({
    ...segment,
    role: segment.role === "body" ? "serif" : segment.role,
    color: segment.color === "#222222" ? "#111111" : segment.color
  })), ctx, { fontSize: 11, color: "#111111", width: contentWidth(ctx), align: "left", lineGap: 2 });
  ctx.doc.moveDown(0.65);
}

function renderList(block: ListNode, ctx: NativePdfContext): void {
  const fontSize = ctx.template.id === "tesis-unsaac" ? 12 : 11;
  const lineGap = ctx.template.id === "tesis-unsaac" ? 3 : 1;
  block.items.forEach((item, index) => {
    const marker = block.ordered ? `${index + 1}.` : item.checked === undefined ? "-" : item.checked ? "[x]" : "[ ]";
    const segments = [
      { text: `${marker} `, role: "body" as const, color: "#222222" },
      ...captureInlineSegments(item.children, ctx, { role: "body", color: "#222222" })
    ];
    const text = segmentText(segments);
    const footnoteRefs = consumeInlineFootnotes(ctx);
    const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
    ensureSpace(ctx, ctx.doc.heightOfString(text, { width: contentWidth(ctx), indent: 18, lineGap }) + 4 + footnoteHeight);
    registerFootnotesOnCurrentPage(footnoteRefs, ctx);
    renderInlineSegments(segments, ctx, { fontSize, color: "#222222", width: contentWidth(ctx), indent: 18, lineGap });
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
  if (ctx.template.id === "tesis-unsaac") {
    ctx.doc.font(fontName(ctx, "italic")).fontSize(10).fillColor("#111111").text(caption, {
      width: contentWidth(ctx),
      align: "left",
      lineGap: 1
    }).moveDown(0.8);
    return;
  }
  ctx.doc.font(fontName(ctx, "body")).fontSize(9).fillColor("#444444").text(caption, { align: "center" }).moveDown(0.8);
}

function renderTable(block: TableNode, ctx: NativePdfContext): void {
  const captionText = inlineText(block.caption ?? [], ctx).trim();
  const hasCaption = captionText.length > 0;
  if (hasCaption) ctx.tableCount += 1;
  const number = hasCaption ? ctx.labels.get(block.attrs?.id ?? "")?.number ?? String(ctx.tableCount) : "";
  const caption = hasCaption ? `Tabla ${number}. ${captionText}` : "";
  const showCaption = hasCaption && ctx.template.id !== "article-digital-economy";
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
    const captionFont: FontRole = ctx.template.id === "tesis-unsaac" ? "italic" : "bold";
    ctx.doc.font(fontName(ctx, captionFont)).fontSize(10).fillColor("#111111").text(caption, { width: contentWidth(ctx), lineGap: 1 });
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
  if (name === "brochure-hero") {
    renderBrochureHero(block, ctx);
    return;
  }
  if (name === "gradient-panel") {
    renderGradientPanel(block, ctx);
    return;
  }
  if (name === "coordinate-plane") {
    renderCoordinatePlane(block, ctx);
    return;
  }
  if (name === "kpi-grid") {
    renderKpiGrid(block, ctx);
    return;
  }
  if (name === "bar-chart") {
    renderBarChart(block, ctx);
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
  if (name === "ficha-registro") {
    if (ctx.template.id === "tesis-unsaac") {
      await renderFichaRegistro(block, ctx);
      return;
    }
    for (const child of block.children) await renderBlock(child, ctx);
    return;
  }
  const specialTitle = unsaacSpecialSectionTitle(block);
  if (ctx.template.id === "tesis-unsaac" && specialTitle) {
    await renderUnsaacSpecialSection(block, specialTitle, ctx);
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
  if (name === "shape") {
    renderShape(block, ctx);
    return;
  }
  if (name === "center") {
    ctx.doc.text(block.children.map((child) => blockText(child, ctx)).join("\n"), { align: "center" }).moveDown();
    return;
  }
  for (const child of block.children) await renderBlock(child, ctx);
}

async function renderDirective(block: DirectiveNode, ctx: NativePdfContext): Promise<void> {
  const name = block.name;
  if (name === "toc") {
    if (ctx.template.id === "informe-operativo") {
      renderOperationalToc(ctx);
      return;
    }
    if (ctx.template.id === "tesis-unsaac") {
      renderUnsaacToc(ctx);
      return;
    }
    const x = ctx.doc.page.margins.left;
    const width = contentWidth(ctx);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#111111").text("Índice", x, ctx.doc.y, { width }).moveDown(0.5);
    ctx.headings.forEach((heading, headingIndex) => {
      ensureSpace(ctx, 18);
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
      ctx.tocPlaceholders.push({
        headingIndex,
        pageIndex: currentPageIndex(ctx),
        x: x + width - 30,
        y,
        width: 30,
        linkX: x,
        linkY: y,
        linkWidth: width,
        linkHeight: 16,
        destination: headingDestination(headingIndex, heading)
      });
      ctx.doc.y = y + 17;
    });
    ctx.doc.moveDown(1);
    return;
  }
  if (name === "lof") {
    renderListOfFigures(ctx);
    return;
  }
  if (name === "lot") {
    renderListOfTables(ctx);
    return;
  }
  if (name === "bibliography") {
    await renderBibliography(ctx);
    return;
  }
  if (name === "pagenumbering") {
    const style = /roman|romana/i.test(block.args) ? "roman" : "arabic";
    ctx.pageNumberingSegments.push({ pageIndex: currentPageIndex(ctx), style });
    return;
  }
  if (name === "newpage" || name === "clearpage") {
    ctx.doc.addPage();
  }
}

async function renderUnsaacSpecialSection(block: FencedDivNode, title: string, ctx: NativePdfContext): Promise<void> {
  if (ctx.doc.y > ctx.doc.page.margins.top + 12) ctx.doc.addPage();
  const includeInToc = shouldIncludeInToc(block);
  const destination = includeInToc ? headingDestination(ctx.headingRenderIndex, ctx.headings[ctx.headingRenderIndex]) : undefined;
  registerPdfDestination(ctx, destination);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(13).fillColor("#111111").text(title.toUpperCase(), {
    width: contentWidth(ctx),
    align: "center"
  });
  ctx.doc.moveDown(1);
  markSyntheticHeadingPage(ctx, block.attrs?.id, includeInToc);
  for (const child of block.children) await renderBlock(child, ctx);
}

function unsaacSpecialSectionTitle(block: FencedDivNode): string | undefined {
  const name = block.canonicalName ?? block.name;
  const explicit = semanticTitle(block, "");
  if (explicit) return explicit;
  const titles: Record<string, string> = {
    presentacion: "PRESENTACIÓN",
    dedicatoria: "DEDICATORIA",
    agradecimiento: "AGRADECIMIENTO",
    abstract: "RESUMEN",
    introduccion: "INTRODUCCIÓN",
    discusiones: "DISCUSIONES",
    conclusiones: "CONCLUSIONES",
    recomendaciones: "RECOMENDACIONES"
  };
  return titles[name];
}

function markSyntheticHeadingPage(ctx: NativePdfContext, id: string | undefined, includeInToc = true): void {
  if (id) markLabelPage(ctx, id);
  if (!includeInToc) return;
  const heading = ctx.headings[ctx.headingRenderIndex];
  const page = currentPageNumber(ctx);
  if (heading) heading.page = page;
  ctx.headingRenderIndex += 1;
}

function renderUnsaacToc(ctx: NativePdfContext): void {
  ctx.doc.addPage();
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(13).fillColor("#111111").text("ÍNDICE", x, ctx.doc.y, { width, align: "center" });
  ctx.doc.moveDown(1);
  ctx.headings.forEach((heading, headingIndex) => {
    const row = renderIndexEntryRow(ctx, {
      text: heading.title,
      x,
      width,
      indent: Math.min(44, Math.max(0, heading.level - 1) * 13),
      fontSize: 10,
      lineGap: 0.8,
      rowGap: 3,
      minHeight: 17,
      pageNumberWidth: 34,
      leaderWidth: 58
    });
    ctx.tocPlaceholders.push({
      headingIndex,
      ...row,
      destination: headingDestination(headingIndex, heading)
    });
  });
  ctx.doc.moveDown(0.6);
}

function renderListOfFigures(ctx: NativePdfContext): void {
  renderListOfLabeledNodes(ctx, "ÍNDICE DE FIGURAS", collectListedNodes(ctx.document.children, "Figure"));
}

function renderListOfTables(ctx: NativePdfContext): void {
  renderListOfLabeledNodes(ctx, "ÍNDICE DE TABLAS", collectListedNodes(ctx.document.children, "Table"));
}

function renderListOfLabeledNodes(ctx: NativePdfContext, title: string, entries: ListedNodeInfo[]): void {
  if (ctx.template.id === "tesis-unsaac") ctx.doc.addPage();
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(ctx.template.id === "tesis-unsaac" ? 13 : 14).fillColor("#111111").text(title, x, ctx.doc.y, {
    width,
    align: ctx.template.id === "tesis-unsaac" ? "center" : "left"
  });
  ctx.doc.moveDown(0.8);
  if (entries.length === 0) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(10).text("No se encontraron elementos para listar.");
    return;
  }
  for (const entry of entries) {
    const label = ctx.labels.get(entry.labelId);
    const entryText = `${label?.type === "fig" ? "Figura" : "Tabla"} ${label?.number ?? ""}. ${entry.title}`;
    const row = renderIndexEntryRow(ctx, {
      text: entryText,
      x,
      width,
      fontSize: ctx.template.id === "tesis-unsaac" ? 9.2 : 10,
      lineGap: ctx.template.id === "tesis-unsaac" ? 0.55 : 0.8,
      rowGap: ctx.template.id === "tesis-unsaac" ? 3 : 4,
      minHeight: ctx.template.id === "tesis-unsaac" ? 15 : 17,
      pageNumberWidth: 34,
      leaderWidth: ctx.template.id === "tesis-unsaac" ? 54 : 58
    });
    ctx.listPlaceholders.push({
      labelId: entry.labelId,
      ...row,
      destination: labelDestination(entry.labelId)
    });
  }
  ctx.doc.moveDown(0.6);
}

function renderIndexEntryRow(
  ctx: NativePdfContext,
  options: {
    text: string;
    x: number;
    width: number;
    indent?: number;
    fontSize: number;
    lineGap: number;
    rowGap: number;
    minHeight: number;
    pageNumberWidth: number;
    leaderWidth: number;
  }
): IndexEntryRow {
  const indent = options.indent ?? 0;
  const pageX = options.x + options.width - options.pageNumberWidth;
  const textX = options.x + indent;
  const leaderEndX = pageX - 8;
  const leaderStartX = Math.max(textX + 28, leaderEndX - options.leaderWidth);
  const textWidth = Math.max(80, leaderStartX - textX - 7);
  const text = safePdfText(options.text);

  ctx.doc.font(fontName(ctx, "body")).fontSize(options.fontSize).fillColor("#111111");
  const textHeight = Math.max(
    ctx.doc.currentLineHeight(true),
    ctx.doc.heightOfString(text, { width: textWidth, lineGap: options.lineGap })
  );
  const rowHeight = Math.max(options.minHeight, textHeight + options.rowGap);
  ensureSpace(ctx, rowHeight);

  const y = ctx.doc.y;
  ctx.doc.font(fontName(ctx, "body")).fontSize(options.fontSize).fillColor("#111111").text(text, textX, y, {
    width: textWidth,
    lineGap: options.lineGap
  });

  const lineHeight = ctx.doc.currentLineHeight(true) + options.lineGap;
  const lastLineY = y + Math.max(0, textHeight - lineHeight);
  const leaderY = lastLineY + lineHeight * 0.68;
  if (leaderStartX < leaderEndX) {
    ctx.doc
      .moveTo(leaderStartX, leaderY)
      .lineTo(leaderEndX, leaderY)
      .lineWidth(0.45)
      .dash(1.2, { space: 2.2 })
      .stroke("#A8A8A8")
      .undash();
  }

  ctx.doc.y = y + rowHeight;
  return {
    pageIndex: currentPageIndex(ctx),
    x: pageX,
    y: lastLineY,
    width: options.pageNumberWidth,
    fontSize: options.fontSize,
    linkX: options.x,
    linkY: y,
    linkWidth: options.width,
    linkHeight: rowHeight
  };
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
    ensureSpace(ctx, 20);
    const y = ctx.doc.y + 2;
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
    ctx.tocPlaceholders.push({
      headingIndex: heading.headingIndex,
      pageIndex: currentPageIndex(ctx),
      x: x + width - 24,
      y,
      width: 24,
      linkX: x,
      linkY: y,
      linkWidth: width,
      linkHeight: 17,
      destination: headingDestination(heading.headingIndex, heading)
    });
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

function renderAcademicBlockquote(children: BlockNode[], ctx: NativePdfContext): void {
  const text = children.map((child) => blockText(child, ctx)).filter(Boolean).join("\n\n");
  if (!text.trim()) return;
  const leftIndent = 36;
  const width = contentWidth(ctx) - leftIndent;
  ctx.doc.font(fontName(ctx, "body")).fontSize(11);
  const height = ctx.doc.heightOfString(text, { width, align: "justify", lineGap: 3 });
  ensureSpace(ctx, height + 18);
  const x = ctx.doc.page.margins.left + leftIndent;
  ctx.doc.font(fontName(ctx, "body")).fontSize(11).fillColor("#222222").text(text, x, ctx.doc.y, {
    width,
    align: "justify",
    lineGap: 3
  });
  ctx.doc.x = ctx.doc.page.margins.left;
  ctx.doc.moveDown(0.8);
}

async function renderFichaRegistro(block: FencedDivNode, ctx: NativePdfContext): Promise<void> {
  if (ctx.doc.y > ctx.doc.page.margins.top + 12) ctx.doc.addPage();
  const firstHeadingIndex = block.children.findIndex((child) => child.kind === "Heading");
  const heading = firstHeadingIndex >= 0 ? block.children[firstHeadingIndex] : undefined;
  const title = safePdfText(semanticTitle(block, heading?.kind === "Heading" ? inlineText(heading.title, ctx) : "Ficha de registro"));
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  ensureSpace(ctx, 52);
  ctx.doc.moveTo(x, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(0.65).stroke("#444444");
  ctx.doc.moveDown(0.35);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(11).fillColor("#111111").text(title.toUpperCase(), {
    width,
    align: "center",
    lineGap: 1
  });
  ctx.doc.moveDown(0.25);
  ctx.doc.moveTo(x + width * 0.35, ctx.doc.y).lineTo(x + width * 0.65, ctx.doc.y).lineWidth(0.45).stroke("#888888");
  ctx.doc.moveDown(0.5);

  for (const child of block.children) {
    if (child === heading) continue;
    await renderFichaBlock(child, ctx);
  }
  ctx.doc.moveTo(x, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(0.45).stroke("#777777");
  ctx.doc.moveDown(0.45);
}

async function renderFichaBlock(block: BlockNode, ctx: NativePdfContext): Promise<void> {
  switch (block.kind) {
    case "Heading":
      renderFichaSectionHeading(block, ctx);
      return;
    case "Paragraph":
      renderFichaParagraph(block.children, ctx);
      return;
    case "List":
      renderFichaList(block, ctx);
      return;
    case "Table":
      renderFichaTable(block, ctx);
      return;
    case "Figure":
      await renderFichaFigure(block, ctx);
      return;
    case "CodeBlock":
      renderFichaCode(block.content, ctx);
      return;
    case "FencedDiv":
    case "Blockquote":
    case "Callout":
      if (block.kind === "FencedDiv" && ["note", "todo"].includes(block.canonicalName ?? block.name)) {
        renderFichaPendingMedia(blockText(block, ctx), ctx);
        return;
      }
      for (const child of block.children) await renderFichaBlock(child, ctx);
      return;
    case "MathBlock":
    case "Directive":
    case "FootnoteDef":
    case "HorizontalRule":
      return;
  }
}

function renderFichaSectionHeading(block: HeadingNode, ctx: NativePdfContext): void {
  const title = inlineText(block.title, ctx).replace(/\s+/g, " ").trim();
  ensureSpace(ctx, 22);
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  ctx.doc.moveDown(0.35);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(9).fillColor("#111111").text(title.toUpperCase(), x, ctx.doc.y, {
    width,
    lineBreak: false
  });
  ctx.doc.moveDown(0.15);
  ctx.doc.moveTo(x, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(0.35).stroke("#8A8A8A");
  ctx.doc.moveDown(0.35);
}

function renderFichaParagraph(children: InlineNode[], ctx: NativePdfContext): void {
  const segments = captureInlineSegments(children, ctx, { role: "body", color: "#222222" });
  const text = segmentText(segments);
  const width = contentWidth(ctx);
  const footnoteRefs = consumeInlineFootnotes(ctx);
  const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
  ensureSpace(ctx, ctx.doc.heightOfString(text, { width, align: "justify", lineGap: 1.6 }) + 8 + footnoteHeight);
  registerFootnotesOnCurrentPage(footnoteRefs, ctx);
  renderInlineSegments(segments, ctx, { fontSize: 9.2, color: "#222222", width, align: "justify", lineGap: 1.6 });
  ctx.doc.moveDown(0.35);
}

function renderFichaList(block: ListNode, ctx: NativePdfContext): void {
  const width = contentWidth(ctx);
  block.items.forEach((item, index) => {
    const marker = block.ordered ? `${index + 1}.` : "-";
    const segments = [
      { text: `${marker} `, role: "body" as const, color: "#222222" },
      ...captureInlineSegments(item.children, ctx, { role: "body", color: "#222222" })
    ];
    const text = segmentText(segments);
    const footnoteRefs = consumeInlineFootnotes(ctx);
    const footnoteHeight = estimateNewFootnotesHeight(footnoteRefs, ctx);
    ensureSpace(ctx, ctx.doc.heightOfString(text, { width, indent: 14, lineGap: 1 }) + 4 + footnoteHeight);
    registerFootnotesOnCurrentPage(footnoteRefs, ctx);
    renderInlineSegments(segments, ctx, { fontSize: 9, color: "#222222", width, indent: 14, lineGap: 1 });
  });
  ctx.doc.moveDown(0.25);
}

function renderFichaTable(block: TableNode, ctx: NativePdfContext): void {
  const columnCount = tableColumnCount(block);
  const style = fichaTableStyle(columnCount);
  const widths = columnWidths(block, columnCount, ctx, style);
  const alignments = normalizeTableAlignments(block.alignments, columnCount);
  const header = layoutTableRow(normalizeTableRow(block.headers, columnCount), widths, ctx, true, style, alignments);
  const rows = block.rows.map((row) => layoutTableRow(normalizeTableRow(row, columnCount), widths, ctx, false, style, alignments));
  ensureSpace(ctx, header.height + style.minRowHeight);
  drawTableRow(header, widths, ctx, style);
  rows.forEach((row, index) => renderTableBodyRow(row, header, widths, ctx, style, index));
  ctx.doc.moveDown(0.45);
  ctx.doc.x = ctx.doc.page.margins.left;
}

async function renderFichaFigure(block: FigureNode, ctx: NativePdfContext): Promise<void> {
  const imagePath = resolveNodePath(block.path, block, ctx);
  const caption = inlineText(block.caption, ctx).trim();
  if (!existsSync(imagePath)) {
    renderFichaPendingMedia(caption || "Registro gráfico pendiente de incorporación/verificación en campo.", ctx);
    return;
  }
  const width = contentWidth(ctx);
  ensureSpace(ctx, 190);
  try {
    ctx.doc.image(imagePath, { fit: [width, 150], align: "center" });
    ctx.doc.moveDown(0.25);
    if (caption) {
      ctx.doc.font(fontName(ctx, "italic")).fontSize(8.5).fillColor("#222222").text(caption, {
        width,
        align: "left",
        lineGap: 0.5
      });
    }
    ctx.doc.moveDown(0.45);
  } catch {
    renderFichaPendingMedia(caption || "Registro gráfico pendiente de incorporación/verificación en campo.", ctx);
  }
}

function renderFichaCode(content: string, ctx: NativePdfContext): void {
  const width = contentWidth(ctx);
  const safeContent = safePdfText(content);
  ctx.doc.font(fontName(ctx, "mono")).fontSize(7.3);
  const height = Math.max(34, ctx.doc.heightOfString(safeContent, { width: width - 16, lineGap: 0.2 }) + 14);
  ensureSpace(ctx, height + 8);
  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  ctx.doc.rect(x, y, width, height).fillAndStroke("#F7F7F7", "#777777");
  ctx.doc.fillColor("#111111").font(fontName(ctx, "mono")).fontSize(7.3).text(safeContent, x + 8, y + 7, {
    width: width - 16,
    lineGap: 0.2
  });
  ctx.doc.y = y + height + 8;
}

function renderFichaPendingMedia(text: string, ctx: NativePdfContext): void {
  const fallback = text.trim() || "Pendiente de incorporación/verificación en campo.";
  const table: TableNode = {
    kind: "Table",
    headers: [[{ kind: "Text", value: "Campo" }], [{ kind: "Text", value: "Dato" }]],
    rows: [
      [[{ kind: "Text", value: "Registro gráfico" }], [{ kind: "Text", value: fallback.replace(/\s+/g, " ") }]]
    ],
    alignments: ["left", "left"],
    attrs: undefined,
    position: undefined
  };
  renderFichaTable(table, ctx);
}

function fichaTableStyle(columnCount: number): TableStyle {
  const compacting = Math.max(0, columnCount - 4);
  return {
    borderColor: "#565656",
    headerFill: "#F0F0F0",
    zebraFill: "#FAFAFA",
    ruleMode: "grid",
    fontSize: Math.max(6.8, 8.1 - compacting * 0.25),
    headerFontSize: Math.max(7.0, 8.2 - compacting * 0.25),
    paddingX: columnCount > 5 ? 3 : 4,
    paddingY: 3,
    lineGap: 0.6,
    minRowHeight: 16
  };
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

function renderBrochureHero(block: FencedDivNode, ctx: NativePdfContext): void {
  const attrs = block.attrs?.normalized ?? {};
  const from = resolvePdfColor(attrs.from, ctx, ctx.template.defaultStyle.colors.primary);
  const to = resolvePdfColor(attrs.to, ctx, ctx.template.defaultStyle.colors.secondary);
  const accent = resolvePdfColor(attrs.accent, ctx, ctx.template.defaultStyle.colors.accent);
  const title = semanticTitle(block, frontmatterText(ctx.document.frontmatter?.data.title) || "Brochure KUI");
  const subtitle = attrs.subtitle ?? block.children.map((child) => blockText(child, ctx)).filter(Boolean).join(" ");
  const kicker = attrs.kicker ?? attrs.label ?? "BROCHURE VISUAL";
  const image = attrs.image;

  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const height = Number(attrs.height ?? 238);
  ensureSpace(ctx, height + 18);
  const y = ctx.doc.y;

  drawLinearGradient(ctx, x, y, width, height, from, to, 18);
  drawSoftCircle(ctx, x + width - 74, y + 58, 142, accent, 0.2);
  drawSoftCircle(ctx, x + 40, y + height - 22, 124, "#FFFFFF", 0.1);

  ctx.doc
    .font(fontName(ctx, "bold"))
    .fontSize(8.5)
    .fillColor(accent)
    .text(kicker.toUpperCase(), x + 24, y + 28, { width: width - 48, characterSpacing: 0.7 });
  ctx.doc
    .font(fontName(ctx, "serifBold"))
    .fontSize(27)
    .fillColor("#FFFFFF")
    .text(title, x + 24, y + 55, { width: image ? width * 0.58 : width - 48, lineGap: 1 });
  ctx.doc
    .font(fontName(ctx, "body"))
    .fontSize(10.5)
    .fillColor("#E0F2FE")
    .text(safePdfText(subtitle), x + 24, y + 137, { width: image ? width * 0.56 : width - 48, lineGap: 2 });

  if (image) {
    try {
      const imagePath = resolveAssetPath(image, { cwd: ctx.options.cwd, sourceFile: ctx.document.sourceFiles[0] });
      ctx.doc.save().fillOpacity(0.16).roundedRect(x + width - 160, y + 43, 118, 118, 22).fill("#FFFFFF").restore();
      ctx.doc.image(imagePath, x + width - 145, y + 58, { fit: [88, 88], align: "center", valign: "center" });
    } catch {
      ctx.diagnostics.push({
        code: "KUI-W091",
        severity: "warning",
        message: `No se pudo renderizar la imagen del hero: ${image}`,
        position: block.position
      });
    }
  }

  ctx.doc.x = x;
  ctx.doc.y = y + height + 18;
}

function renderGradientPanel(block: FencedDivNode, ctx: NativePdfContext): void {
  const attrs = block.attrs?.normalized ?? {};
  const from = resolvePdfColor(attrs.from, ctx, ctx.template.defaultStyle.colors.primary);
  const to = resolvePdfColor(attrs.to, ctx, ctx.template.defaultStyle.colors.secondary);
  const accent = resolvePdfColor(attrs.accent, ctx, ctx.template.defaultStyle.colors.accent);
  const title = semanticTitle(block, "");
  const text = block.children.map((child) => blockText(child, ctx)).filter(Boolean).join("\n\n");
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const textWidth = width - 44;
  ctx.doc.font(fontName(ctx, "body")).fontSize(10);
  const textHeight = ctx.doc.heightOfString(text, { width: textWidth, lineGap: 2 });
  const titleHeight = title ? 30 : 0;
  const height = Math.max(104, titleHeight + textHeight + 46);
  ensureSpace(ctx, height + 16);
  const y = ctx.doc.y;

  drawLinearGradient(ctx, x, y, width, height, from, to, 14);
  drawSoftCircle(ctx, x + width - 36, y + 16, 96, accent, 0.18);
  drawSoftCircle(ctx, x + 18, y + height - 12, 86, "#FFFFFF", 0.1);
  ctx.doc.rect(x, y, 7, height).fill(accent);

  let cursorY = y + 22;
  if (title) {
    ctx.doc.font(fontName(ctx, "bold")).fontSize(13).fillColor("#FFFFFF").text(title, x + 22, cursorY, {
      width: textWidth,
      lineBreak: false
    });
    cursorY += 28;
  }
  ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#F8FAFC").text(text, x + 22, cursorY, {
    width: textWidth,
    lineGap: 2
  });

  ctx.doc.x = x;
  ctx.doc.y = y + height + 16;
}

function renderCoordinatePlane(block: FencedDivNode, ctx: NativePdfContext): void {
  const points = coordinatePointsFromChildren(block.children, ctx);
  if (points.length < 2) return;
  if (ctx.template.id === "plano-tecnico") {
    renderTechnicalCoordinateSheet(block, points, ctx);
    return;
  }

  const attrs = block.attrs?.normalized ?? {};
  const title = semanticTitle(block, "Plano cartesiano UTM");
  const srid = attrs.srid ?? "WGS84 / UTM zona 18S";
  const location = attrs.location ?? attrs.ubicacion ?? "Cusco, Peru";
  const stroke = resolvePdfColor(attrs.color, ctx, ctx.template.defaultStyle.colors.secondary);
  const fill = resolvePdfColor(attrs.fill ?? attrs.bg, ctx, "#A78BFA");

  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const plotHeight = Number(attrs.height ?? 430);
  const titleHeight = 38;
  const statsHeight = 58;
  const totalHeight = titleHeight + plotHeight + statsHeight + 20;
  ensureSpace(ctx, totalHeight + 12);
  const y = ctx.doc.y;

  ctx.doc.font(fontName(ctx, "bold")).fontSize(15).fillColor("#111827").text(title, x, y, { width });
  ctx.doc.font(fontName(ctx, "body")).fontSize(8.6).fillColor("#64748B").text(`${srid} · ${location}`, x, y + 21, {
    width,
    lineBreak: false
  });

  const plotX = x;
  const plotY = y + titleHeight;
  const plotW = width;
  const plotH = plotHeight;
  const padding = 50;
  const bounds = coordinateBounds(points);
  const xRange = Math.max(1, bounds.maxX - bounds.minX);
  const yRange = Math.max(1, bounds.maxY - bounds.minY);
  const expandX = Math.max(8, xRange * 0.08);
  const expandY = Math.max(8, yRange * 0.08);
  const minX = bounds.minX - expandX;
  const maxX = bounds.maxX + expandX;
  const minY = bounds.minY - expandY;
  const maxY = bounds.maxY + expandY;

  const mapX = (value: number): number => plotX + padding + ((value - minX) / (maxX - minX)) * (plotW - padding * 1.5);
  const mapY = (value: number): number => plotY + padding * 0.6 + (1 - ((value - minY) / (maxY - minY))) * (plotH - padding * 1.35);

  ctx.doc.roundedRect(plotX, plotY, plotW, plotH, 8).fillAndStroke("#F8FAFC", "#CBD5E1");
  renderCoordinateBackground(block, ctx, plotX, plotY, plotW, plotH);
  drawCoordinateGrid(ctx, plotX, plotY, plotW, plotH, padding, minX, maxX, minY, maxY, mapX, mapY);
  drawNorthArrow(ctx, plotX + plotW - 54, plotY + 32);

  const mapped = points.map((point) => ({ ...point, px: mapX(point.x), py: mapY(point.y) }));
  if (mapped.length >= 3) {
    ctx.doc.save().fillOpacity(0.18);
    ctx.doc.moveTo(mapped[0].px, mapped[0].py);
    mapped.slice(1).forEach((point) => ctx.doc.lineTo(point.px, point.py));
    ctx.doc.closePath().fill(fill);
    ctx.doc.restore();
  }

  ctx.doc.moveTo(mapped[0].px, mapped[0].py);
  mapped.slice(1).forEach((point) => ctx.doc.lineTo(point.px, point.py));
  if (mapped.length >= 3) ctx.doc.closePath();
  ctx.doc.lineWidth(2.2).stroke(stroke);

  mapped.forEach((point, index) => {
    ctx.doc.circle(point.px, point.py, 4.2).fillAndStroke("#FFFFFF", stroke);
    const labelX = point.px + (index % 2 === 0 ? 7 : -36);
    const labelY = point.py - 11;
    ctx.doc.font(fontName(ctx, "bold")).fontSize(7.5).fillColor("#111827").text(point.label, labelX, labelY, {
      width: 32,
      lineBreak: false
    });
  });

  const area = mapped.length >= 3 ? polygonArea(points) : 0;
  const perimeter = mapped.length >= 3 ? polygonPerimeter(points, true) : polygonPerimeter(points, false);
  const statsY = plotY + plotH + 12;
  const stats = [
    { label: "Puntos", value: String(points.length) },
    { label: "Area", value: area > 0 ? `${formatNumber(area)} m2` : "Sin poligono" },
    { label: "Hectareas", value: area > 0 ? `${formatNumber(area / 10_000, 4)} ha` : "-" },
    { label: "Perimetro", value: `${formatNumber(perimeter)} m` }
  ];
  drawCoordinateStats(ctx, x, statsY, width, stats);

  ctx.doc.x = x;
  ctx.doc.y = statsY + statsHeight;
}

function renderTechnicalCoordinateSheet(block: FencedDivNode, points: CoordinatePoint[], ctx: NativePdfContext): void {
  addCoordinateDiagnostics(block, points, ctx);

  const attrs = block.attrs?.normalized ?? {};
  const data = ctx.document.frontmatter?.data ?? {};
  const page = ctx.doc.page;
  const sheetX = page.margins.left;
  const sheetY = page.margins.top;
  const sheetW = page.width - page.margins.left - page.margins.right;
  const sheetH = page.height - page.margins.top - page.margins.bottom;
  const title = semanticTitle(block, frontmatterText(data.title) || "Plano tecnico");
  const srid = attrs.srid ?? "WGS84 / UTM zona 18S";
  const location = (attrs.location ?? frontmatterText(data.location ?? data.ubicacion)) || "Cusco, Peru";
  const scaleText = (attrs.scale ?? frontmatterText(data.scale ?? data.escala)) || "1:1000";
  const stroke = resolvePdfColor(attrs.color, ctx, ctx.template.defaultStyle.colors.secondary);
  const fill = resolvePdfColor(attrs.fill ?? attrs.bg, ctx, "#A78BFA");

  const titleBlockH = 148;
  const plotX = sheetX + 14;
  const plotY = sheetY + 14;
  const plotW = sheetW - 28;
  const plotH = sheetH - titleBlockH - 28;
  const titleBlockY = plotY + plotH + 10;

  ctx.doc.rect(sheetX, sheetY, sheetW, sheetH).stroke("#111827");
  ctx.doc.roundedRect(plotX, plotY, plotW, plotH, 4).fillAndStroke("#F8FAFC", "#111827");
  renderCoordinateBackground(block, ctx, plotX, plotY, plotW, plotH);

  const viewport = coordinateViewport(points, plotX, plotY, plotW, plotH, {
    left: 58,
    right: 28,
    top: 36,
    bottom: 52
  });
  drawCoordinateGrid(ctx, plotX, plotY, plotW, plotH, 58, viewport.minX, viewport.maxX, viewport.minY, viewport.maxY, viewport.mapX, viewport.mapY);
  drawNorthArrow(ctx, plotX + plotW - 58, plotY + 32);

  const mapped = points.map((point) => ({ ...point, px: viewport.mapX(point.x), py: viewport.mapY(point.y) }));
  if (mapped.length >= 3) {
    ctx.doc.save().fillOpacity(0.18);
    ctx.doc.moveTo(mapped[0].px, mapped[0].py);
    mapped.slice(1).forEach((point) => ctx.doc.lineTo(point.px, point.py));
    ctx.doc.closePath().fill(fill);
    ctx.doc.restore();
  }
  ctx.doc.moveTo(mapped[0].px, mapped[0].py);
  mapped.slice(1).forEach((point) => ctx.doc.lineTo(point.px, point.py));
  if (mapped.length >= 3) ctx.doc.closePath();
  ctx.doc.lineWidth(2.4).stroke(stroke);
  mapped.forEach((point) => drawPointLabel(ctx, point.px, point.py, point.label, stroke));

  drawScaleBar(ctx, plotX + 84, plotY + 32, viewport.pixelsPerMeter);

  const area = mapped.length >= 3 ? polygonArea(points) : 0;
  const perimeter = mapped.length >= 3 ? polygonPerimeter(points, true) : polygonPerimeter(points, false);
  const stats = [
    { label: "Area", value: area > 0 ? `${formatNumber(area)} m2` : "-" },
    { label: "Hectareas", value: area > 0 ? `${formatNumber(area / 10_000, 4)} ha` : "-" },
    { label: "Perimetro", value: `${formatNumber(perimeter)} m` },
    { label: "Escala", value: scaleText }
  ];
  drawTechnicalTitleBlock(ctx, sheetX, titleBlockY, sheetW, sheetY + sheetH - titleBlockY, {
    title,
    subtitle: String(data.subtitle ?? "Poligono irregular en coordenadas UTM"),
    author: authorText(data.author),
    date: String(data.date ?? new Date().getFullYear()),
    location,
    srid,
    stats,
    sides: sideMeasurements(points)
  });

  ctx.doc.x = sheetX;
  ctx.doc.y = sheetY + sheetH + 1;
}

function renderCoordinateBackground(
  block: FencedDivNode,
  ctx: NativePdfContext,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const attrs = block.attrs?.normalized ?? {};
  const background = attrs.background ?? attrs.image;
  if (!background) return;

  const opacity = clampNumber(Number(attrs.opacity ?? attrs.backgroundOpacity ?? 0.42), 0.08, 0.9);
  try {
    const imagePath = resolveAssetPath(background, { cwd: ctx.options.cwd, sourceFile: ctx.document.sourceFiles[0] });
    ctx.doc.save();
    ctx.doc.roundedRect(x, y, width, height, 4).clip();
    ctx.doc.opacity(opacity);
    ctx.doc.image(imagePath, x, y, { width, height });
    ctx.doc.restore();
    ctx.doc.save().fillOpacity(0.22).rect(x, y, width, height).fill("#F8FAFC").restore();
  } catch {
    ctx.diagnostics.push({
      code: "KUI-W112",
      severity: "warning",
      message: `No se pudo renderizar el fondo del plano: ${background}`,
      position: block.position
    });
  }
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

function renderBarChart(block: FencedDivNode, ctx: NativePdfContext): void {
  const values = semanticItemsFromChildren(block.children, ctx)
    .map((item) => ({ ...item, numeric: numericSemanticValue(item) }))
    .filter((item) => Number.isFinite(item.numeric));
  if (values.length === 0) {
    renderStatusGrid(block, ctx);
    return;
  }

  const title = semanticTitle(block, "Grafico de barras");
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const rows = values.slice(0, 12);
  const rowHeight = 26;
  const height = 38 + rows.length * rowHeight + 16;
  ensureSpace(ctx, height + 12);

  const colors = ctx.template.defaultStyle.colors;
  const maxValue = Math.max(1, ...rows.map((item) => Math.abs(item.numeric)));
  const labelWidth = Math.min(150, width * 0.36);
  const valueWidth = 48;
  const barWidth = width - labelWidth - valueWidth - 24;
  const y = ctx.doc.y;

  ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, y, { width });
  ctx.doc.moveTo(x, y + 24).lineTo(x + width, y + 24).lineWidth(0.6).stroke("#CBD5E1");

  rows.forEach((item, index) => {
    const rowY = y + 36 + index * rowHeight;
    const ratio = Math.min(1, Math.abs(item.numeric) / maxValue);
    const barFill = [colors.primary, colors.secondary, colors.accent][index % 3] ?? "#2563EB";
    const label = item.label || item.detail || `Serie ${index + 1}`;
    const value = item.value || String(item.numeric);

    ctx.doc.font(fontName(ctx, "body")).fontSize(8.4).fillColor("#374151").text(label, x, rowY + 3, {
      width: labelWidth,
      lineBreak: false
    });
    ctx.doc.roundedRect(x + labelWidth + 12, rowY + 4, barWidth, 11, 5).fill("#EEF2F7");
    ctx.doc.roundedRect(x + labelWidth + 12, rowY + 4, Math.max(4, barWidth * ratio), 11, 5).fill(barFill);
    ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#111827").text(value, x + labelWidth + barWidth + 18, rowY + 3, {
      width: valueWidth,
      align: "right",
      lineBreak: false
    });
  });

  ctx.doc.x = x;
  ctx.doc.y = y + height;
}

function renderShape(block: FencedDivNode, ctx: NativePdfContext): void {
  const attrs = block.attrs?.normalized ?? {};
  const type = (attrs.type ?? "square").toLowerCase();
  const size = shapeSize(attrs.size);
  const title = semanticTitle(block, "");
  const text = block.children.map((child) => blockText(child, ctx)).filter(Boolean).join(" ").trim();
  const stroke = resolvePdfColor(attrs.color, ctx, ctx.template.defaultStyle.colors.primary);
  const fill = resolvePdfColor(attrs.fill ?? attrs.bg, ctx, "#FFFFFF");
  const width = contentWidth(ctx);
  const titleHeight = title ? 20 : 0;
  const height = titleHeight + size + 18;
  ensureSpace(ctx, height + 12);

  const x = ctx.doc.page.margins.left;
  const y = ctx.doc.y;
  if (title) {
    ctx.doc.font(fontName(ctx, "bold")).fontSize(10).fillColor("#111827").text(title, x, y, { width });
  }

  const shapeX = x + (width - size) / 2;
  const shapeY = y + titleHeight + 2;
  if (block.attrs?.classes.includes("shadow")) {
    drawShapePath(type, shapeX + 5, shapeY + 5, size, "#E5E7EB", "#E5E7EB", ctx);
  }
  drawShapePath(type, shapeX, shapeY, size, fill, stroke, ctx);

  if (text) {
    const textWidth = size - 16;
    ctx.doc.font(fontName(ctx, "bold")).fontSize(Math.max(7.5, Math.min(10.5, size / 9))).fillColor(resolveShapeTextColor(fill));
    const textHeight = ctx.doc.heightOfString(text, { width: textWidth, align: "center", lineGap: 1 });
    ctx.doc.text(text, shapeX + 8, shapeY + size / 2 - textHeight / 2, {
      width: textWidth,
      align: "center",
      lineGap: 1
    });
  }

  ctx.doc.x = x;
  ctx.doc.y = y + height + 2;
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
  const bibliographySources = normalizeReferenceSources(ctx.document.frontmatter?.data);
  ctx.doc.addPage();
  ctx.doc.font(fontName(ctx, "bold")).fontSize(ctx.template.id === "tesis-unsaac" ? 13 : 16).fillColor("#111111").text(
    ctx.template.id === "tesis-unsaac" ? "BIBLIOGRAFÍA" : "Bibliografía",
    { align: ctx.template.id === "tesis-unsaac" ? "center" : "left" }
  ).moveDown(0.8);
  if (bibliographySources.length === 0) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(10).text("No se declaró archivo bibliográfico.");
    return;
  }
  for (const source of bibliographySources) {
    const file = resolveSourcePath(source.path, ctx);
    try {
      const content = await readFile(file, "utf8");
      const entries = parseReferenceContent(content, source.format);
      if (entries.length === 0) {
        ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#9A3412").text(`No se encontraron referencias en ${source.path}`);
        continue;
      }
      for (const entry of entries) {
        ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#222222").text(safePdfText(formatReferenceEntry(entry)), { indent: 18, lineGap: 2 });
        ctx.doc.moveDown(0.4);
      }
    } catch {
      ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#9A3412").text(`No se pudo leer ${source.path}`);
    }
  }
}

async function loadReferenceEntries(ctx: NativePdfContext): Promise<Map<string, KuiReferenceEntry>> {
  const references = new Map<string, KuiReferenceEntry>();
  for (const source of normalizeReferenceSources(ctx.document.frontmatter?.data)) {
    const file = resolveSourcePath(source.path, ctx);
    try {
      const content = await readFile(file, "utf8");
      for (const entry of parseReferenceContent(content, source.format)) {
        if (!references.has(entry.key)) references.set(entry.key, entry);
      }
    } catch {
      // Bibliography rendering reports unreadable sources; citations fall back to keys.
    }
  }
  return references;
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
    if (ctx.template.id === "tesis-unsaac" && index === 0) continue;
    if (ctx.template.id === "brochure-visual" && index === 0) continue;
    if (ctx.template.id === "plano-tecnico") continue;
    const pageNumber = displayPageNumber(ctx, index);
    const originalBottomMargin = ctx.doc.page.margins.bottom;
    ctx.doc.page.margins.bottom = 0;
    ctx.doc
      .font(fontName(ctx, "body"))
      .fontSize(9)
      .fillColor("#666666")
      .text(pageNumber, 0, ctx.doc.page.height - 42, { align: "center" });
    ctx.doc.page.margins.bottom = originalBottomMargin;
  }
}

function displayPageNumber(ctx: NativePdfContext, pageIndex: number): string {
  const segments = ctx.pageNumberingSegments
    .filter((segment) => segment.pageIndex <= pageIndex)
    .sort((a, b) => a.pageIndex - b.pageIndex);
  const active = segments[segments.length - 1];
  if (!active) return String(pageIndex + 1);
  const value = Math.max(1, pageIndex - active.pageIndex + 1);
  return active.style === "roman" ? toRoman(value).toLowerCase() : String(value);
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
  for (const placeholder of ctx.tocPlaceholders) {
    const heading = ctx.headings[placeholder.headingIndex];
    if (!heading?.page) continue;
    ctx.doc.switchToPage(placeholder.pageIndex);
    ctx.doc
      .font(fontName(ctx, "body"))
      .fontSize(placeholder.fontSize ?? 10)
      .fillColor("#111111")
      .text(String(heading.page), placeholder.x, placeholder.y, {
        width: placeholder.width,
        align: "right",
        lineBreak: false
      });
    addInternalLink(ctx, placeholder.linkX, placeholder.linkY, placeholder.linkWidth, placeholder.linkHeight, placeholder.destination);
  }
  for (const placeholder of ctx.listPlaceholders) {
    const label = ctx.labels.get(placeholder.labelId);
    if (!label?.page) continue;
    ctx.doc.switchToPage(placeholder.pageIndex);
    ctx.doc
      .font(fontName(ctx, "body"))
      .fontSize(placeholder.fontSize ?? 10)
      .fillColor("#111111")
      .text(String(label.page), placeholder.x, placeholder.y, {
        width: placeholder.width,
        align: "right",
        lineBreak: false
      });
    addInternalLink(ctx, placeholder.linkX, placeholder.linkY, placeholder.linkWidth, placeholder.linkHeight, placeholder.destination);
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

function captureInlineSegments(nodes: InlineNode[], ctx: NativePdfContext, style: InlineStyle): InlineSegment[] {
  ctx.currentInlineFootnotes = [];
  return mergeInlineSegments(inlineSegments(nodes, ctx, style));
}

function consumeInlineFootnotes(ctx: NativePdfContext): string[] {
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

function segmentText(segments: InlineSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

function renderInlineSegments(
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

function coordinatePointsFromChildren(children: BlockNode[], ctx: NativePdfContext): CoordinatePoint[] {
  return semanticLinesFromChildren(children, ctx).flatMap((line, index) => {
    const point = parseCoordinatePoint(line, index + 1);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? [point] : [];
  });
}

function parseCoordinatePoint(raw: string, fallbackIndex: number): CoordinatePoint | undefined {
  const text = raw.replace(/^[-*+]\s+/, "").trim();
  const colon = text.match(/^(.+?):\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)/);
  if (colon) {
    return {
      label: colon[1].trim(),
      x: parseCoordinateNumber(colon[2]),
      y: parseCoordinateNumber(colon[3])
    };
  }

  const spaced = text.match(/^(\S+)\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)(?:\s+.*)?$/);
  if (spaced) {
    return {
      label: spaced[1],
      x: parseCoordinateNumber(spaced[2]),
      y: parseCoordinateNumber(spaced[3])
    };
  }

  const parts = text.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      label: parts[0],
      x: parseCoordinateNumber(parts[1]),
      y: parseCoordinateNumber(parts[2])
    };
  }
  if (parts.length >= 2) {
    return {
      label: `P${fallbackIndex}`,
      x: parseCoordinateNumber(parts[0]),
      y: parseCoordinateNumber(parts[1])
    };
  }
  return undefined;
}

function parseCoordinateNumber(value: string): number {
  return Number(value.replace(/\s+/g, "").replace(",", "."));
}

function coordinateBounds(points: CoordinatePoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y))
  };
}

function polygonArea(points: CoordinatePoint[]): number {
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum) / 2;
}

function polygonPerimeter(points: CoordinatePoint[], closed: boolean): number {
  let sum = 0;
  const limit = closed ? points.length : points.length - 1;
  for (let index = 0; index < limit; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    sum += Math.hypot(next.x - point.x, next.y - point.y);
  }
  return sum;
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

function drawLinearGradient(
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

function drawSoftCircle(ctx: NativePdfContext, centerX: number, centerY: number, diameter: number, color: string, opacity: number): void {
  ctx.doc.save().fillOpacity(opacity).circle(centerX, centerY, diameter / 2).fill(color).restore();
}

function drawCoordinateGrid(
  ctx: NativePdfContext,
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  mapX: (value: number) => number,
  mapY: (value: number) => number
): void {
  const left = x + padding;
  const right = x + width - padding * 0.5;
  const top = y + padding * 0.6;
  const bottom = y + height - padding * 0.75;
  const ticks = 5;

  ctx.doc.lineWidth(0.45).stroke("#E2E8F0");
  for (let index = 0; index <= ticks; index++) {
    const xValue = minX + ((maxX - minX) * index) / ticks;
    const gridX = mapX(xValue);
    ctx.doc.moveTo(gridX, top).lineTo(gridX, bottom).stroke("#E2E8F0");
    ctx.doc.font(fontName(ctx, "body")).fontSize(6.8).fillColor("#64748B").text(formatNumber(xValue, 0), gridX - 22, bottom + 8, {
      width: 44,
      align: "center",
      lineBreak: false
    });

    const yValue = minY + ((maxY - minY) * index) / ticks;
    const gridY = mapY(yValue);
    ctx.doc.moveTo(left, gridY).lineTo(right, gridY).stroke("#E2E8F0");
    ctx.doc.font(fontName(ctx, "body")).fontSize(6.8).fillColor("#64748B").text(formatNumber(yValue, 0), x + 6, gridY - 4, {
      width: padding - 12,
      align: "right",
      lineBreak: false
    });
  }

  ctx.doc.lineWidth(1).stroke("#334155");
  ctx.doc.moveTo(left, bottom).lineTo(right, bottom).stroke("#334155");
  ctx.doc.moveTo(left, bottom).lineTo(left, top).stroke("#334155");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#334155").text("X / Este (m)", left, y + height - 20, {
    width: right - left,
    align: "center",
    lineBreak: false
  });
  ctx.doc.save().rotate(-90, { origin: [x + 13, y + height / 2] });
  ctx.doc.text("Y / Norte (m)", x + 13, y + height / 2, {
    width: height - padding,
    align: "center",
    lineBreak: false
  });
  ctx.doc.restore();
}

function coordinateViewport(
  points: CoordinatePoint[],
  x: number,
  y: number,
  width: number,
  height: number,
  padding: { left: number; right: number; top: number; bottom: number }
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pixelsPerMeter: number;
  mapX: (value: number) => number;
  mapY: (value: number) => number;
} {
  const bounds = coordinateBounds(points);
  const xRange = Math.max(1, bounds.maxX - bounds.minX);
  const yRange = Math.max(1, bounds.maxY - bounds.minY);
  const expandX = Math.max(8, xRange * 0.08);
  const expandY = Math.max(8, yRange * 0.08);
  const minX = bounds.minX - expandX;
  const maxX = bounds.maxX + expandX;
  const minY = bounds.minY - expandY;
  const maxY = bounds.maxY + expandY;
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const usableW = width - padding.left - padding.right;
  const usableH = height - padding.top - padding.bottom;
  const pixelsPerMeter = Math.min(usableW / rangeX, usableH / rangeY);
  const usedW = rangeX * pixelsPerMeter;
  const usedH = rangeY * pixelsPerMeter;
  const left = x + padding.left + (usableW - usedW) / 2;
  const bottom = y + height - padding.bottom - (usableH - usedH) / 2;

  return {
    minX,
    maxX,
    minY,
    maxY,
    pixelsPerMeter,
    mapX: (value: number): number => left + (value - minX) * pixelsPerMeter,
    mapY: (value: number): number => bottom - (value - minY) * pixelsPerMeter
  };
}

function drawPointLabel(ctx: NativePdfContext, x: number, y: number, label: string, color: string): void {
  ctx.doc.circle(x, y, 4.2).fillAndStroke("#FFFFFF", color);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(7.5).fillColor("#111827").text(label, x + 7, y - 11, {
    width: 34,
    lineBreak: false
  });
}

function drawNorthArrow(ctx: NativePdfContext, x: number, y: number): void {
  ctx.doc
    .moveTo(x, y + 26)
    .lineTo(x + 10, y)
    .lineTo(x + 20, y + 26)
    .closePath()
    .fillAndStroke("#111827", "#111827");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#111827").text("N", x + 6, y + 31, {
    width: 12,
    align: "center",
    lineBreak: false
  });
}

function drawScaleBar(ctx: NativePdfContext, x: number, y: number, pixelsPerMeter: number): void {
  const meters = niceScaleDistance(120 / Math.max(0.001, pixelsPerMeter));
  const width = meters * pixelsPerMeter;
  const half = width / 2;
  ctx.doc.rect(x, y, half, 7).fill("#111827");
  ctx.doc.rect(x + half, y, half, 7).fillAndStroke("#FFFFFF", "#111827");
  ctx.doc.moveTo(x, y - 3).lineTo(x, y + 12).stroke("#111827");
  ctx.doc.moveTo(x + half, y - 3).lineTo(x + half, y + 12).stroke("#111827");
  ctx.doc.moveTo(x + width, y - 3).lineTo(x + width, y + 12).stroke("#111827");
  ctx.doc.font(fontName(ctx, "body")).fontSize(7).fillColor("#111827").text("0", x - 4, y + 14, {
    width: 12,
    align: "center",
    lineBreak: false
  });
  ctx.doc.text(formatNumber(meters / 2, 0), x + half - 16, y + 14, {
    width: 32,
    align: "center",
    lineBreak: false
  });
  ctx.doc.text(`${formatNumber(meters, 0)} m`, x + width - 18, y + 14, {
    width: 46,
    align: "center",
    lineBreak: false
  });
}

function niceScaleDistance(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function drawCoordinateStats(
  ctx: NativePdfContext,
  x: number,
  y: number,
  width: number,
  stats: Array<{ label: string; value: string }>
): void {
  const gap = 8;
  const cardWidth = (width - gap * (stats.length - 1)) / stats.length;
  stats.forEach((item, index) => {
    const cardX = x + index * (cardWidth + gap);
    ctx.doc.roundedRect(cardX, y, cardWidth, 42, 6).fillAndStroke("#FFFFFF", "#CBD5E1");
    ctx.doc.font(fontName(ctx, "bold")).fontSize(9.5).fillColor("#111827").text(item.value, cardX + 10, y + 10, {
      width: cardWidth - 20,
      lineBreak: false
    });
    ctx.doc.font(fontName(ctx, "body")).fontSize(6.8).fillColor("#64748B").text(item.label.toUpperCase(), cardX + 10, y + 27, {
      width: cardWidth - 20,
      lineBreak: false
    });
  });
}

function drawTechnicalTitleBlock(
  ctx: NativePdfContext,
  x: number,
  y: number,
  width: number,
  height: number,
  info: {
    title: string;
    subtitle: string;
    author: string;
    date: string;
    location: string;
    srid: string;
    stats: Array<{ label: string; value: string }>;
    sides: Array<{ side: string; distance: number; azimuth: number }>;
  }
): void {
  ctx.doc.rect(x, y, width, height).stroke("#111827");
  const leftW = width * 0.5;
  const midW = width * 0.24;
  const rightW = width - leftW - midW;
  ctx.doc.moveTo(x + leftW, y).lineTo(x + leftW, y + height).stroke("#111827");
  ctx.doc.moveTo(x + leftW + midW, y).lineTo(x + leftW + midW, y + height).stroke("#111827");

  ctx.doc.font(fontName(ctx, "bold")).fontSize(12).fillColor("#111827").text(info.title, x + 10, y + 12, {
    width: leftW - 20,
    lineBreak: false
  });
  ctx.doc.font(fontName(ctx, "body")).fontSize(8.2).fillColor("#475569").text(info.subtitle, x + 10, y + 32, {
    width: leftW - 20,
    lineGap: 1
  });
  const metaY = y + 72;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(7.5).fillColor("#111827").text("UBICACION", x + 10, metaY, { width: 80, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor("#334155").text(info.location, x + 92, metaY, { width: leftW - 102, lineBreak: false });
  ctx.doc.font(fontName(ctx, "bold")).fontSize(7.5).fillColor("#111827").text("SISTEMA", x + 10, metaY + 16, { width: 80, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor("#334155").text(info.srid, x + 92, metaY + 16, { width: leftW - 102, lineBreak: false });
  ctx.doc.font(fontName(ctx, "bold")).fontSize(7.5).fillColor("#111827").text("RESP.", x + 10, metaY + 32, { width: 80, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor("#334155").text(info.author || "Equipo KUI", x + 92, metaY + 32, {
    width: leftW - 102,
    lineBreak: false
  });

  const statsX = x + leftW;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#111827").text("DATOS DEL POLIGONO", statsX + 8, y + 10, {
    width: midW - 16,
    lineBreak: false
  });
  info.stats.forEach((item, index) => {
    const rowY = y + 30 + index * 24;
    ctx.doc.moveTo(statsX, rowY - 5).lineTo(statsX + midW, rowY - 5).stroke("#CBD5E1");
    ctx.doc.font(fontName(ctx, "body")).fontSize(6.8).fillColor("#64748B").text(item.label.toUpperCase(), statsX + 8, rowY, {
      width: midW * 0.42,
      lineBreak: false
    });
    ctx.doc.font(fontName(ctx, "bold")).fontSize(7.4).fillColor("#111827").text(item.value, statsX + midW * 0.42, rowY, {
      width: midW * 0.54,
      align: "right",
      lineBreak: false
    });
  });
  ctx.doc.font(fontName(ctx, "body")).fontSize(6.8).fillColor("#64748B").text(info.date, statsX + 8, y + height - 18, {
    width: midW - 16,
    lineBreak: false
  });

  const sideX = x + leftW + midW;
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor("#111827").text("LADOS", sideX + 8, y + 10, {
    width: rightW - 16,
    lineBreak: false
  });
  ctx.doc.font(fontName(ctx, "body")).fontSize(6.6).fillColor("#64748B").text("Lado", sideX + 8, y + 28, { width: 44, lineBreak: false });
  ctx.doc.text("Dist.", sideX + 52, y + 28, { width: 44, align: "right", lineBreak: false });
  ctx.doc.text("Azimut", sideX + 102, y + 28, { width: rightW - 110, align: "right", lineBreak: false });
  info.sides.slice(0, 8).forEach((side, index) => {
    const rowY = y + 42 + index * 11.5;
    ctx.doc.font(fontName(ctx, "body")).fontSize(6.5).fillColor("#111827").text(side.side, sideX + 8, rowY, {
      width: 44,
      lineBreak: false
    });
    ctx.doc.text(formatNumber(side.distance, 2), sideX + 52, rowY, { width: 44, align: "right", lineBreak: false });
    ctx.doc.text(`${formatNumber(side.azimuth, 1)}°`, sideX + 102, rowY, {
      width: rightW - 110,
      align: "right",
      lineBreak: false
    });
  });
}

function sideMeasurements(points: CoordinatePoint[]): Array<{ side: string; distance: number; azimuth: number }> {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const azimuth = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return {
      side: `${point.label}-${next.label}`,
      distance: Math.hypot(dx, dy),
      azimuth
    };
  });
}

function addCoordinateDiagnostics(block: FencedDivNode, points: CoordinatePoint[], ctx: NativePdfContext): void {
  const seen = new Set<string>();
  for (const point of points) {
    const key = `${point.x}:${point.y}`;
    if (seen.has(key)) {
      ctx.diagnostics.push({
        code: "KUI-W110",
        severity: "warning",
        message: `El plano tiene coordenadas repetidas en ${point.label}.`,
        position: block.position
      });
      break;
    }
    seen.add(key);
  }
  if (points.length >= 4 && polygonSelfIntersects(points)) {
    ctx.diagnostics.push({
      code: "KUI-W111",
      severity: "warning",
      message: "El poligono del plano parece cruzarse a si mismo.",
      position: block.position
    });
  }
}

function polygonSelfIntersects(points: CoordinatePoint[]): boolean {
  for (let a = 0; a < points.length; a++) {
    const a2 = (a + 1) % points.length;
    for (let b = a + 1; b < points.length; b++) {
      const b2 = (b + 1) % points.length;
      if (a === b || a2 === b || b2 === a) continue;
      if (segmentsIntersect(points[a], points[a2], points[b], points[b2])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: CoordinatePoint, b: CoordinatePoint, c: CoordinatePoint, d: CoordinatePoint): boolean {
  const orient = (p: CoordinatePoint, q: CoordinatePoint, r: CoordinatePoint): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function numericSemanticValue(item: SemanticItem): number {
  const source = [item.value, item.detail, item.label].filter(Boolean).join(" ");
  const match = source.match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : Number.NaN;
}

function shapeSize(value: string | undefined): number {
  const size = (value ?? "medium").toLowerCase();
  const sizes: Record<string, number> = {
    xs: 46,
    sm: 60,
    small: 60,
    md: 78,
    medium: 78,
    lg: 98,
    large: 98,
    xl: 116,
    "2xl": 136,
    huge: 136,
    "3xl": 156
  };
  return sizes[size] ?? 78;
}

function resolvePdfColor(value: string | undefined, ctx: NativePdfContext, fallback: string): string {
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

function formatNumber(value: number, decimals = value >= 100 ? 0 : 2): string {
  return value.toLocaleString("es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function drawShapePath(type: string, x: number, y: number, size: number, fill: string, stroke: string, ctx: NativePdfContext): void {
  if (type === "circle" || type === "circulo" || type === "círculo") {
    ctx.doc.circle(x + size / 2, y + size / 2, size / 2).fillAndStroke(fill, stroke);
    return;
  }
  if (type === "triangle" || type === "triangulo" || type === "triángulo") {
    ctx.doc
      .moveTo(x + size / 2, y)
      .lineTo(x + size, y + size)
      .lineTo(x, y + size)
      .closePath()
      .fillAndStroke(fill, stroke);
    return;
  }
  ctx.doc.roundedRect(x, y, size, size, 7).fillAndStroke(fill, stroke);
}

function resolveShapeTextColor(fill: string): string {
  const match = fill.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "#111827";
  const raw = match[1];
  const hex = raw.length === 3 ? [...raw].map((char) => `${char}${char}`).join("") : raw;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance < 0.58 ? "#FFFFFF" : "#111827";
}

function collectHeadings(blocks: BlockNode[]): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const visit = (block: BlockNode): void => {
    if (isFichaRegistroBlock(block)) return;
    if (block.kind === "FencedDiv") {
      const title = unsaacSpecialSectionTitle(block);
      if (title && shouldIncludeInToc(block)) headings.push({ level: 1, title, id: block.attrs?.id });
    }
    if (block.kind === "Heading") {
      const level = block.attrs?.classes.includes("chapter") ? 1 : block.level;
      if (shouldIncludeInToc(block)) headings.push({ level, title: inlineText(block.title), id: block.attrs?.id });
    }
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return headings;
}

function collectListedNodes(blocks: BlockNode[], kind: "Figure" | "Table"): ListedNodeInfo[] {
  const entries: ListedNodeInfo[] = [];
  const visit = (block: BlockNode): void => {
    if (isFichaRegistroBlock(block)) return;
    const title = block.kind === "Figure" ? inlineText(block.caption) : block.kind === "Table" ? inlineText(block.caption ?? []) : "";
    if (block.kind === kind && block.attrs?.id && title.trim()) {
      entries.push({
        labelId: block.attrs.id,
        title
      });
    }
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return entries;
}

function shouldIncludeInToc(block: Pick<HeadingNode | FencedDivNode, "attrs">): boolean {
  const attrs = block.attrs;
  if (!attrs) return true;
  if (attrs.classes.includes("notoc") || attrs.classes.includes("no-toc")) return false;
  const value = String(attrs.normalized.toc ?? attrs.kv.toc ?? "").trim().toLowerCase();
  return !["0", "false", "no", "off", "none"].includes(value);
}

function isFichaRegistroBlock(block: BlockNode): boolean {
  return block.kind === "FencedDiv" && (block.canonicalName ?? block.name) === "ficha-registro";
}

function toRoman(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return String(value);
  const pairs: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let remaining = Math.floor(value);
  let output = "";
  for (const [amount, symbol] of pairs) {
    while (remaining >= amount) {
      output += symbol;
      remaining -= amount;
    }
  }
  return output;
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
  if (ctx.template.id === "tesis-unsaac") {
    return {
      borderColor: "#111111",
      headerFill: "#FFFFFF",
      zebraFill: "#FFFFFF",
      ruleMode: "booktabs",
      fontSize: Math.max(6.6, 8.2 - compacting * 0.25),
      headerFontSize: Math.max(6.8, 8.3 - compacting * 0.25),
      paddingX: columnCount > 5 ? 3.2 : 4.2,
      paddingY: 3.4,
      lineGap: 0.8,
      minRowHeight: 17
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

function currentPageIndex(ctx: NativePdfContext): number {
  const range = ctx.doc.bufferedPageRange();
  return range.start + range.count - 1;
}

function currentPageNumber(ctx: NativePdfContext): number {
  return currentPageIndex(ctx) + 1;
}

function headingDestination(index: number, heading?: HeadingInfo): string {
  return pdfDestinationName(`heading-${index + 1}-${heading?.id ?? heading?.title ?? "section"}`);
}

function labelDestination(id: string): string {
  return pdfDestinationName(`label-${id}`);
}

function pdfDestinationName(value: string): string {
  return `kui-${value}`.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function registerPdfDestination(ctx: NativePdfContext, destination: string | undefined): void {
  if (!destination || ctx.registeredDestinations.has(destination)) return;
  ctx.doc.addNamedDestination(destination, "XYZ", ctx.doc.page.margins.left, ctx.doc.y, null);
  ctx.registeredDestinations.add(destination);
}

function addInternalLink(ctx: NativePdfContext, x: number, y: number, width: number, height: number, destination: string): void {
  ctx.doc.goTo(x, y, Math.max(1, width), Math.max(1, height), destination);
}

function markLabelPage(ctx: NativePdfContext, id: string | undefined): void {
  if (!id) return;
  const info = ctx.labels.get(id);
  if (info) info.page = currentPageNumber(ctx);
  registerPdfDestination(ctx, labelDestination(id));
}

function markHeadingPage(ctx: NativePdfContext, block: HeadingNode, includeInToc = true): void {
  markLabelPage(ctx, block.attrs?.id);
  if (!includeInToc) return;
  const heading = ctx.headings[ctx.headingRenderIndex];
  const page = currentPageNumber(ctx);
  if (heading) heading.page = page;
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
  return resolveAssetPath(rawPath, { cwd: ctx.options.cwd, sourceFile: node.position?.file });
}

function resolveSourcePath(rawPath: string, ctx: NativePdfContext): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  const sourceFile = ctx.document.sourceFiles[0];
  return sourceFile ? path.resolve(path.dirname(sourceFile), rawPath) : path.resolve(ctx.options.cwd, rawPath);
}
