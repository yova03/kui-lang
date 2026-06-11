import type { PageFootnote, NativePdfContext } from "./types.js";
import { fontName } from "./fonts.js";
import { contentWidth, currentPageIndex, renderIcon, formatExpedienteLabel, frontmatterText } from "./layout.js";
import { toRoman } from "./toc.js";

export function renderPageNumbers(ctx: NativePdfContext): void {
  const range = ctx.doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    ctx.doc.switchToPage(index);
    if (ctx.template.id === "informe-operativo") {
      renderOperationalHeaderFooter(ctx, index);
      continue;
    }
    if (ctx.template.id === "carta-institucional") {
      renderCartaHeaderFooter(ctx, index);
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
  const colors = ctx.template.defaultStyle.colors;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const top = 36;
  const footerY = ctx.doc.page.height - 35;
  const range = ctx.doc.bufferedPageRange();
  const totalContentPages = Math.max(1, range.count - 1);
  const originalBottomMargin = ctx.doc.page.margins.bottom;
  ctx.doc.page.margins.bottom = 0;

  const expediente = frontmatterText(data.expediente);
  const headerLeft = expediente ? formatExpedienteLabel(expediente) : (frontmatterText(data.organization) || "KUI");
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor(colors.secondary).text(headerLeft, x, top, { width: width * 0.55, lineBreak: false });

  const periodo = frontmatterText(data.periodo) || frontmatterText(data.period);
  if (periodo) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(7.5);
    const iconW = 12;
    const badgeW = Math.ceil(ctx.doc.widthOfString(periodo)) + iconW + 16;
    const badgeX = x + width - badgeW;
    ctx.doc.roundedRect(badgeX, top - 1, badgeW, 14, 2).fill(colors.secondary);
    renderIcon(ctx, "calendar", 8, "#FFFFFF", badgeX + 5, top + 2);
    ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor("#FFFFFF").text(periodo, badgeX + iconW + 6, top + 2, { width: badgeW - iconW - 14, lineBreak: false });
  } else {
    const right = String(data.headerRight ?? "Reporte");
    ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#667085").text(right, x + width * 0.55, top, { width: width * 0.45, align: "right", lineBreak: false });
  }

  ctx.doc.moveTo(x, top + 18).lineTo(x + width, top + 18).lineWidth(0.8).stroke(colors.secondary);
  ctx.doc.moveTo(x, footerY - 10).lineTo(x + width, footerY - 10).lineWidth(0.5).stroke("#CBD5E1");

  const footerOrg = frontmatterText(data.organization) || String(data.footerLeft ?? "");
  const footerOrgX = x + 12;
  renderIcon(ctx, "label", 8, "#667085", x, footerY + 0.5);
  ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#667085").text(footerOrg, footerOrgX, footerY, { width: width * 0.6 - 12, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(8).fillColor("#667085").text(`Pág. ${pageIndex} de ${totalContentPages}`, x + width * 0.6, footerY, { width: width * 0.4, align: "right", lineBreak: false });

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

function renderCartaHeaderFooter(ctx: NativePdfContext, pageIndex: number): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const colors = ctx.template.defaultStyle.colors;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);
  const top = 28;
  const footerY = ctx.doc.page.height - 30;
  const range = ctx.doc.bufferedPageRange();
  const totalPages = range.count;
  const displayPage = pageIndex + 1;
  const originalBottomMargin = ctx.doc.page.margins.bottom;
  ctx.doc.page.margins.bottom = 0;

  const expediente = frontmatterText(data.expediente);
  if (expediente) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor(colors.muted).text(formatExpedienteLabel(expediente), x, top, { width: width * 0.6, lineBreak: false });
  }

  const periodo = frontmatterText(data.periodo);
  if (periodo) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(7.5);
    const iconW = 12;
    const badgeW = Math.ceil(ctx.doc.widthOfString(periodo)) + iconW + 16;
    const badgeX = x + width - badgeW;
    ctx.doc.roundedRect(badgeX, top - 1, badgeW, 13, 2).fill(colors.secondary);
    renderIcon(ctx, "calendar", 8, "#FFFFFF", badgeX + 5, top + 1);
    ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor("#FFFFFF").text(periodo, badgeX + iconW + 6, top + 1.5, { width: badgeW - iconW - 14, lineBreak: false });
  }

  ctx.doc.moveTo(x, footerY - 8).lineTo(x + width, footerY - 8).lineWidth(0.5).stroke("#CBD5E1");

  const orgName = frontmatterText(data.organizacion) || frontmatterText(data.organization) || "";
  ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor(colors.muted).text(orgName, x, footerY, { width: width * 0.6, lineBreak: false });
  ctx.doc.font(fontName(ctx, "body")).fontSize(7.5).fillColor(colors.muted).text(`Pág. ${displayPage} de ${totalPages}`, x + width * 0.6, footerY, { width: width * 0.4, align: "right", lineBreak: false });

  ctx.doc.page.margins.bottom = originalBottomMargin;
}

export function renderFootnotes(ctx: NativePdfContext): void {
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

export function registerFootnotesOnCurrentPage(refs: string[], ctx: NativePdfContext): void {
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

export function estimateNewFootnotesHeight(refs: string[], ctx: NativePdfContext): number {
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
