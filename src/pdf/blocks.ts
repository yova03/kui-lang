import type { BlockNode, DirectiveNode, FigureNode, FencedDivNode, HeadingNode, InlineNode, ListNode, MathBlockNode } from "../core/ast.js";
import type { NativePdfContext, InlineSegment } from "./types.js";
import { fontName } from "./fonts.js";
import { ensureSpace, contentWidth, drawRule, currentPageIndex, headingDestination, registerPdfDestination, markLabelPage, markHeadingPage, usesProfessionalBodyStyle, resolveNodePath } from "./layout.js";
import { inlineText, captureInlineSegments, consumeInlineFootnotes, segmentText, renderInlineSegments, blockText, formatMath, safePdfText } from "./inline.js";
import { renderUnsaacToc, renderListOfFigures, renderListOfTables, renderOperationalToc, markSyntheticHeadingPage, shouldIncludeInToc, toRoman } from "./toc.js";
import { registerFootnotesOnCurrentPage, estimateNewFootnotesHeight } from "./chrome.js";
import { renderTable } from "./tables.js";
import { renderFichaRegistro, renderExecutiveSummary, renderBrochureHero, renderGradientPanel, renderKpiGrid, renderBarChart, renderShape, renderRiskMatrix, renderStatusGrid, renderTimeline, renderSignature, semanticTitle } from "./semantic.js";
import { renderCoordinatePlane } from "./plano.js";
import { renderBibliography } from "./native-pdf.js";

export async function renderBlock(block: BlockNode, ctx: NativePdfContext): Promise<void> {
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
      if (usesProfessionalBodyStyle(ctx.template.id)) {
        renderInformeBlockquote(block.children, ctx);
        return;
      }
      renderBox("Cita", block.children, ctx, "#F6F6F6", "#666666");
      return;
    case "Callout":
      if (usesProfessionalBodyStyle(ctx.template.id)) {
        renderInformeBlockquote(block.children, ctx);
        return;
      }
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
  if (usesProfessionalBodyStyle(ctx.template.id)) {
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
  const x = ctx.doc.page.margins.left;
  const maxWidth = ctx.doc.page.width - ctx.doc.page.margins.left - ctx.doc.page.margins.right;
  const maxHeight = 300;
  const radius = 8;
  ensureSpace(ctx, 350);
  markLabelPage(ctx, block.attrs?.id);
  const imgY = ctx.doc.y;
  try {
    ctx.doc.save();
    ctx.doc.roundedRect(x, imgY, maxWidth, maxHeight, radius).clip();
    ctx.doc.image(imagePath, x, imgY, { fit: [maxWidth, maxHeight], align: "center" });
    ctx.doc.restore();
    const colors = ctx.template.defaultStyle.colors;
    const borderColor = usesProfessionalBodyStyle(ctx.template.id)
      ? colors.accent : "#CBD5E1";
    ctx.doc.roundedRect(x, imgY, maxWidth, maxHeight, radius).lineWidth(0.5).stroke(borderColor);
    ctx.doc.y = imgY + maxHeight;
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
      hint: remoteImageRenderHint(block.path, imagePath),
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
    if (usesProfessionalBodyStyle(ctx.template.id)) {
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

export function unsaacSpecialSectionTitle(block: FencedDivNode): string | undefined {
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

function renderInformeBlockquote(children: BlockNode[], ctx: NativePdfContext): void {
  const text = children.map((child) => blockText(child, ctx)).filter(Boolean).join("\n\n");
  if (!text.trim()) return;
  const colors = ctx.template.defaultStyle.colors;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const barW = 3;
  const padLeft = 13;
  const padY = 8;
  const textW = width - barW - padLeft;
  ctx.doc.font(fontName(ctx, "body")).fontSize(10);
  const textH = ctx.doc.heightOfString(text, { width: textW, lineGap: 2 });
  const boxH = textH + padY * 2;
  ensureSpace(ctx, boxH + 8);
  const y = ctx.doc.y;
  ctx.doc.rect(x, y, width, boxH).fill("#FFF8F5");
  ctx.doc.rect(x, y, barW, boxH).fill(colors.secondary);
  ctx.doc.font(fontName(ctx, "body")).fontSize(10).fillColor("#222222").text(text, x + barW + padLeft, y + padY, { width: textW, lineGap: 2 });
  ctx.doc.y = y + boxH + 8;
}

function remoteImageRenderHint(rawPath: string, resolvedPath: string): string | undefined {
  if (!/^https?:\/\//i.test(rawPath) || resolvedPath !== rawPath) return undefined;
  return "Ejecuta kui assets check antes de kui pdf para descargar la imagen en build/cache/assets.";
}
