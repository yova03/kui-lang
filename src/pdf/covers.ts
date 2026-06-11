import { resolveAssetPath } from "../utils/asset-resolver.js";
import type { NativePdfContext } from "./types.js";
import { fontName } from "./fonts.js";
import { ensureSpace, contentWidth, drawLinearGradient, drawSoftCircle, renderIcon, authorText, frontmatterText, frontmatterPairs, frontmatterList } from "./layout.js";
import { safePdfText } from "./inline.js";

export function renderTitle(ctx: NativePdfContext): void {
  if (ctx.template.id === "plano-tecnico") return;
  if (ctx.template.id === "brochure-visual") {
    renderBrochureCover(ctx);
    return;
  }
  if (ctx.template.id === "informe-operativo") {
    renderOperationalCover(ctx);
    return;
  }
  if (ctx.template.id === "carta-institucional") {
    renderCartaCover(ctx);
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
  const dni = frontmatterText(data.dni);
  const orcid = frontmatterText(data.orcid);
  const asesor = frontmatterText(data.asesor);
  const coasesor = frontmatterText(data.coasesor);
  const jurado = frontmatterList(data.jurado);
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
  writeLabel("DNI:", dni);
  writeLabel("ORCID:", orcid);
  writeLabel("PARA OPTAR AL TÍTULO PROFESIONAL", degree ? `DE ${degree.toUpperCase()}` : "");
  writeLabel("ASESOR:", asesor);
  writeLabel("CO-ASESOR:", coasesor);
  writeLabel("JURADO:", jurado.join("\n"));

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

function renderCartaCover(ctx: NativePdfContext): void {
  const data = ctx.document.frontmatter?.data ?? {};
  const colors = ctx.template.defaultStyle.colors;
  const x = ctx.doc.page.margins.left;
  const width = contentWidth(ctx);

  const orgName = frontmatterText(data.organizacion) || frontmatterText(data.organization) || "Organización";
  ctx.doc.font(fontName(ctx, "bold")).fontSize(16).fillColor("#111111").text(orgName, x, ctx.doc.y, { width });
  ctx.doc.moveDown(0.18);
  ctx.doc.moveTo(x, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(1.5).stroke(colors.secondary);
  ctx.doc.moveDown(0.45);

  const contacto = frontmatterText(data.contacto);
  if (contacto) {
    ctx.doc.font(fontName(ctx, "body")).fontSize(8.5).fillColor(colors.muted).text(contacto, x, ctx.doc.y, { width });
    ctx.doc.moveDown(0.35);
  }

  ctx.doc.moveTo(x, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(0.4).stroke("#D1D5DB");
  ctx.doc.moveDown(0.75);

  const tipoDoc = frontmatterText(data.tipoDocumento) || "COMUNICACIÓN INSTITUCIONAL";
  const tipoDocY = ctx.doc.y;
  const iconOffset = 14;
  renderIcon(ctx, "description", 8, colors.secondary, x, tipoDocY + 0.5);
  ctx.doc.font(fontName(ctx, "bold")).fontSize(8).fillColor(colors.secondary).text(tipoDoc.toUpperCase(), x + iconOffset, tipoDocY, { width: width - iconOffset });
  ctx.doc.moveDown(0.3);

  const title = frontmatterText(data.title) || "Documento";
  ctx.doc.font(fontName(ctx, "serifBold")).fontSize(13).fillColor("#111111").text(title, x, ctx.doc.y, { width });
  ctx.doc.moveDown(0.2);

  const subtitle = frontmatterText(data.subtitle);
  if (subtitle) {
    ctx.doc.font(fontName(ctx, "serifBold")).fontSize(12).fillColor("#222222").text(subtitle, x, ctx.doc.y, { width });
    ctx.doc.moveDown(0.2);
  }

  ctx.doc.moveDown(0.5);

  const expediente = frontmatterText(data.expediente);
  const referencia = frontmatterText(data.referencia);
  const asunto = frontmatterText(data.asunto);
  const metaRows: Array<[string, string]> = [];
  if (expediente) metaRows.push(["EXPEDIENTE", expediente]);
  if (referencia) metaRows.push(["REFERENCIA", referencia]);
  if (asunto) metaRows.push(["ASUNTO", asunto]);

  if (metaRows.length > 0) {
    const barW = 2;
    const labelW = 66;
    const padX = 10;
    const padY = 6;
    const rowGap = 0.5;
    const textW = width - barW - padX - labelW - 4;
    ctx.doc.font(fontName(ctx, "body")).fontSize(8.5);
    for (let idx = 0; idx < metaRows.length; idx++) {
      const [label, value] = metaRows[idx];
      const rowH = Math.max(22, ctx.doc.heightOfString(value, { width: textW }) + padY * 2);
      const rowY = ctx.doc.y;
      ctx.doc.rect(x, rowY, width, rowH).fill("#F8FAFC");
      ctx.doc.rect(x, rowY, barW, rowH).fill(colors.secondary);
      ctx.doc.font(fontName(ctx, "bold")).fontSize(7).fillColor(colors.secondary)
        .text(label, x + barW + padX, rowY + padY, { width: labelW, lineBreak: false });
      ctx.doc.font(fontName(ctx, "body")).fontSize(8.5).fillColor("#111111")
        .text(value, x + barW + padX + labelW + 4, rowY + padY - 1, { width: textW });
      ctx.doc.y = rowY + rowH + rowGap;
      if (idx < metaRows.length - 1) {
        ctx.doc.moveTo(x + barW + padX, ctx.doc.y).lineTo(x + width, ctx.doc.y).lineWidth(0.3).stroke("#E2E8F0");
        ctx.doc.y += rowGap;
      }
    }
    ctx.doc.moveDown(0.8);
  } else {
    ctx.doc.moveDown(0.3);
  }
}
