import type { InlineNode, TableNode } from "../core/ast.js";
import type { NativePdfContext, TableStyle, TableCellLayout, TableRowLayout, FontRole } from "./types.js";
import { fontName } from "./fonts.js";
import { ensureSpace, hasSpace, availableContentHeight, contentWidth, reservedFootnoteHeight, markLabelPage, usesProfessionalBodyStyle } from "./layout.js";
import { inlineText } from "./inline.js";

export function renderTable(block: TableNode, ctx: NativePdfContext): void {
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

export function renderTableBodyRow(
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

export function drawTableRow(row: TableRowLayout, widths: number[], ctx: NativePdfContext, style: TableStyle, zebra = false): void {
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

export function tableColumnCount(block: TableNode): number {
  return Math.max(1, block.headers.length, ...block.rows.map((row) => row.length));
}

function tableStyle(columnCount: number, ctx: NativePdfContext): TableStyle {
  const compacting = Math.max(0, columnCount - 4);
  if (usesProfessionalBodyStyle(ctx.template.id)) {
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

export function normalizeTableRow(row: InlineNode[][], columnCount: number): InlineNode[][] {
  return Array.from({ length: columnCount }, (_unused, index) => row[index] ?? []);
}

export function normalizeTableAlignments(alignments: TableNode["alignments"], columnCount: number): Array<"left" | "center" | "right"> {
  return Array.from({ length: columnCount }, (_unused, index) => alignments?.[index] ?? "left");
}

export function columnWidths(block: TableNode, columnCount: number, ctx: NativePdfContext, style: TableStyle): number[] {
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

export function layoutTableRow(
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
