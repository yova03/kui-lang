import { existsSync } from "node:fs";
import type { BlockNode, FigureNode, FencedDivNode, HeadingNode, InlineNode, ListNode, TableNode } from "../core/ast.js";
import { resolveAssetPath } from "../utils/asset-resolver.js";
import type { NativePdfContext, TableStyle, SemanticItem } from "./types.js";
import { fontName } from "./fonts.js";
import { ensureSpace, hasSpace, contentWidth, drawLinearGradient, drawSoftCircle, resolvePdfColor, authorText, frontmatterText, resolveNodePath } from "./layout.js";
import { inlineText, captureInlineSegments, consumeInlineFootnotes, segmentText, renderInlineSegments, blockText, safePdfText } from "./inline.js";
import { registerFootnotesOnCurrentPage, estimateNewFootnotesHeight } from "./chrome.js";
import { renderTableBodyRow, drawTableRow, tableColumnCount, normalizeTableRow, normalizeTableAlignments, columnWidths, layoutTableRow } from "./tables.js";

export async function renderFichaRegistro(block: FencedDivNode, ctx: NativePdfContext): Promise<void> {
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

export function renderExecutiveSummary(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderBrochureHero(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderGradientPanel(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderKpiGrid(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderBarChart(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderShape(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderRiskMatrix(block: FencedDivNode, ctx: NativePdfContext): void {
  const title = semanticTitle(block, "Matriz de riesgo operativo");
  const table = firstTable(block.children);
  if (!table) {
    renderStatusGrid(block, ctx);
    return;
  }
  renderSemanticTable(title, table, ctx, { priorityAware: true, compact: false });
}

export function renderStatusGrid(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderTimeline(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function renderSignature(block: FencedDivNode, ctx: NativePdfContext): void {
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

export function semanticTitle(block: FencedDivNode, fallback: string): string {
  return safePdfText(block.attrs?.normalized.title ?? block.attrs?.kv.title ?? fallback);
}

function semanticItemsFromChildren(children: BlockNode[], ctx: NativePdfContext): SemanticItem[] {
  const lines = semanticLinesFromChildren(children, ctx);
  return lines.map(splitSemanticItem).filter((item) => item.label || item.value);
}

export function semanticLinesFromChildren(children: BlockNode[], ctx: NativePdfContext): string[] {
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
