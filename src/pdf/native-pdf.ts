import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { DocumentNode } from "../core/ast.js";
import type { CompileOptions } from "../core/project.js";
import { formatReferenceEntry, normalizeReferenceSources, parseReferenceContent, type KuiReferenceEntry } from "../semantic/bibliography.js";
import { resolveTemplate } from "../templates/registry.js";
import type { NativePdfOutput, NativePdfPageMap, NativePdfContext } from "./types.js";
import { registerDocumentFonts, fontName } from "./fonts.js";
import { collectLabels, collectFootnotes, authorText } from "./layout.js";
import { safePdfText } from "./inline.js";
import { renderTocPageNumbers, collectHeadings } from "./toc.js";
import { renderPageNumbers, renderFootnotes } from "./chrome.js";
import { renderTitle } from "./covers.js";
import { renderBlock } from "./blocks.js";

export type { NativePdfOutput, NativePdfPageMap, LabelInfo, HeadingInfo } from "./types.js";

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

export async function renderBibliography(ctx: NativePdfContext): Promise<void> {
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

function resolveSourcePath(rawPath: string, ctx: NativePdfContext): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  const sourceFile = ctx.document.sourceFiles[0];
  return sourceFile ? path.resolve(path.dirname(sourceFile), rawPath) : path.resolve(ctx.options.cwd, rawPath);
}
