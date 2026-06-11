import type { BlockNode, FencedDivNode, HeadingNode } from "../core/ast.js";
import type { HeadingInfo, IndexEntryRow, ListedNodeInfo, NativePdfContext } from "./types.js";
import { fontName } from "./fonts.js";
import { ensureSpace, contentWidth, currentPageIndex, currentPageNumber, headingDestination, labelDestination, addInternalLink, markLabelPage } from "./layout.js";
import { inlineText, safePdfText } from "./inline.js";
import { unsaacSpecialSectionTitle } from "./blocks.js";

export function markSyntheticHeadingPage(ctx: NativePdfContext, id: string | undefined, includeInToc = true): void {
  if (id) markLabelPage(ctx, id);
  if (!includeInToc) return;
  const heading = ctx.headings[ctx.headingRenderIndex];
  const page = currentPageNumber(ctx);
  if (heading) heading.page = page;
  ctx.headingRenderIndex += 1;
}

export function renderUnsaacToc(ctx: NativePdfContext): void {
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

export function renderListOfFigures(ctx: NativePdfContext): void {
  renderListOfLabeledNodes(ctx, "ÍNDICE DE FIGURAS", collectListedNodes(ctx.document.children, "Figure"));
}

export function renderListOfTables(ctx: NativePdfContext): void {
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

export function renderOperationalToc(ctx: NativePdfContext): void {
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const colors = ctx.template.defaultStyle.colors;
  const numColWidth = 24;
  const headings = ctx.headings
    .map((heading, headingIndex) => ({ ...heading, headingIndex }))
    .filter((heading) => heading.level === 1 || heading.level === 2);

  ctx.doc.font(fontName(ctx, "bold")).fontSize(15).fillColor("#111111").text("ÍNDICE", x, ctx.doc.y, { width });
  ctx.doc.moveDown(0.3);
  ctx.doc.moveTo(x, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(1.5).stroke(colors.secondary);
  ctx.doc.moveDown(0.65);

  headings.forEach((heading) => {
    const isH1 = heading.level === 1;
    const indent = isH1 ? 0 : 16;
    const fontSize = isH1 ? 10 : 9.5;
    const fontRole = isH1 ? "bold" : "body";
    const titleWidth = width - indent - numColWidth - 4;

    ensureSpace(ctx, 20);
    const y = ctx.doc.y + 2;

    ctx.doc.font(fontName(ctx, fontRole)).fontSize(fontSize).fillColor("#111111").text(heading.title, x + indent, y, {
      width: titleWidth,
      lineBreak: false
    });

    const rawTextWidth = ctx.doc.widthOfString(heading.title);
    const dotsStartX = x + indent + Math.min(titleWidth - 4, rawTextWidth) + 5;
    const dotsEndX = x + width - numColWidth - 3;
    if (dotsEndX > dotsStartX + 6) {
      ctx.doc
        .moveTo(dotsStartX, y + fontSize * 0.72)
        .lineTo(dotsEndX, y + fontSize * 0.72)
        .dash(1, { space: 3.5 })
        .lineWidth(0.6)
        .stroke(colors.muted)
        .undash();
    }

    ctx.tocPlaceholders.push({
      headingIndex: heading.headingIndex,
      pageIndex: currentPageIndex(ctx),
      x: x + width - numColWidth,
      y,
      width: numColWidth,
      fontSize,
      linkX: x,
      linkY: y,
      linkWidth: width,
      linkHeight: fontSize + 8,
      destination: headingDestination(heading.headingIndex, heading)
    });

    ctx.doc.y = y + fontSize + 7;
  });
  ctx.doc.moveDown(0.5);
}

export function renderTocPageNumbers(ctx: NativePdfContext): void {
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

export function collectHeadings(blocks: BlockNode[]): HeadingInfo[] {
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

export function shouldIncludeInToc(block: Pick<HeadingNode | FencedDivNode, "attrs">): boolean {
  const attrs = block.attrs;
  if (!attrs) return true;
  if (attrs.classes.includes("notoc") || attrs.classes.includes("no-toc")) return false;
  const value = String(attrs.normalized.toc ?? attrs.kv.toc ?? "").trim().toLowerCase();
  return !["0", "false", "no", "off", "none"].includes(value);
}

export function isFichaRegistroBlock(block: BlockNode): boolean {
  return block.kind === "FencedDiv" && (block.canonicalName ?? block.name) === "ficha-registro";
}

export function toRoman(value: number): string {
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
