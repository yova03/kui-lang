import type { BlockNode, FencedDivNode } from "../core/ast.js";
import { resolveAssetPath } from "../utils/asset-resolver.js";
import type { NativePdfContext, CoordinatePoint } from "./types.js";
import { fontName } from "./fonts.js";
import { ensureSpace, contentWidth, resolvePdfColor, formatNumber, clampNumber, authorText, frontmatterText } from "./layout.js";
import { semanticTitle, semanticLinesFromChildren } from "./semantic.js";

export function renderCoordinatePlane(block: FencedDivNode, ctx: NativePdfContext): void {
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
