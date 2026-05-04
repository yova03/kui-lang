import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { BlockNode, DocumentNode, FigureNode, InlineNode } from "../core/ast.js";
import { DiagnosticBag, type SourcePosition } from "../core/diagnostics.js";
import { resolveAssetPath } from "../utils/asset-resolver.js";

export type AssetStatus = "ok" | "missing" | "remote" | "unsupported";

export interface AssetAuditItem {
  kind: "figure";
  rawPath: string;
  resolvedPath: string;
  status: AssetStatus;
  format?: string;
  image?: AssetImageMetadata;
  caption: string;
  cachePath?: string;
  sourceFile?: string;
  line?: number;
  position?: SourcePosition;
}

export interface AssetImageMetadata {
  width?: number;
  height?: number;
  dpiX?: number;
  dpiY?: number;
}

export interface AssetAuditOptions {
  cwd: string;
  outputDir?: string;
  ensureCache?: boolean;
  includeCaptionDiagnostics?: boolean;
}

export interface AssetAuditResult {
  items: AssetAuditItem[];
  diagnostics: DiagnosticBag;
  cacheDir?: string;
  watchedFiles: string[];
}

export interface AssetCacheOptions extends AssetAuditOptions {
  fetchRemote?: boolean;
  fetchImpl?: typeof fetch;
}

interface AssetCacheManifest {
  version: 1;
  assets: Record<string, { file: string; format?: string; updatedAt: string }>;
}

const ASSET_CACHE_MANIFEST = "manifest.json";
const SUPPORTED_LOCAL_ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function auditDocumentAssets(document: DocumentNode, options: AssetAuditOptions): AssetAuditResult {
  const diagnostics = new DiagnosticBag();
  const cacheDir = options.outputDir ? path.resolve(options.cwd, options.outputDir, "cache", "assets") : undefined;
  if (cacheDir && options.ensureCache) mkdirSync(cacheDir, { recursive: true });

  const figures = collectFigures(document.children);
  const items = figures.map((figure, index) => auditFigureAsset(figure, index, options, cacheDir, diagnostics));
  const watchedFiles = items
    .filter((item) => item.status === "ok" || item.status === "unsupported")
    .filter((item) => !isRemotePath(item.resolvedPath) && existsSync(item.resolvedPath))
    .map((item) => item.resolvedPath);

  return {
    items,
    diagnostics,
    cacheDir,
    watchedFiles: [...new Set(watchedFiles)]
  };
}

export async function auditAndCacheDocumentAssets(document: DocumentNode, options: AssetCacheOptions): Promise<AssetAuditResult> {
  const audit = auditDocumentAssets(document, options);
  if (!options.ensureCache || !options.fetchRemote || !audit.cacheDir) return audit;

  const fetchImpl = options.fetchImpl ?? fetch;
  for (const [index, item] of audit.items.entries()) {
    if (item.status !== "remote") continue;
    try {
      const response = await fetchImpl(item.rawPath);
      if (!response.ok) {
        reuseCachedRemoteOrWarn(audit, item, `HTTP ${response.status}. Revisa la URL o descarga el archivo en figuras/.`);
        continue;
      }
      const extension = remoteAssetExtension(item.rawPath, response.headers.get("content-type"));
      const cachePath = assetCachePath(audit.cacheDir, index, item.rawPath, extension);
      const bytes = Buffer.from(await response.arrayBuffer());
      writeFileSync(cachePath, bytes);
      updateAssetCacheManifest(audit.cacheDir, item.rawPath, cachePath, extension);
      item.cachePath = cachePath;
      item.format = extension;
      item.image = inspectImageMetadata(cachePath);
      warnLowDpi(item, audit.diagnostics);
      audit.diagnostics.info("KUI-I035", `Asset remoto cacheado: ${item.rawPath}`, item.position, cachePath);
    } catch (error) {
      reuseCachedRemoteOrWarn(audit, item, error instanceof Error ? error.message : undefined);
    }
  }

  return audit;
}

function reuseCachedRemoteOrWarn(audit: AssetAuditResult, item: AssetAuditItem, hint?: string): void {
  const cachedPath = audit.cacheDir ? readCachedAssetPath(item.rawPath, audit.cacheDir) : undefined;
  if (cachedPath) {
    item.cachePath = cachedPath;
    item.format = path.extname(cachedPath).toLowerCase() || item.format;
    item.image = inspectImageMetadata(cachedPath);
    warnLowDpi(item, audit.diagnostics);
    audit.diagnostics.info("KUI-I036", `Se usara el cache existente para el asset remoto: ${item.rawPath}`, item.position, cachedPath);
    return;
  }
  audit.diagnostics.warning(
    "KUI-W034",
    `No se pudo cachear el asset remoto: ${item.rawPath}`,
    item.position,
    hint
  );
}

export function resolveCachedAssetPath(rawPath: string, outputDir: string): string | undefined {
  return readCachedAssetPath(rawPath, path.resolve(outputDir, "cache", "assets"));
}

function readCachedAssetPath(rawPath: string, cacheDir: string): string | undefined {
  const manifest = readAssetCacheManifest(cacheDir);
  const entry = manifest.assets[rawPath];
  if (!entry) return undefined;
  const cachedPath = path.resolve(cacheDir, entry.file);
  return existsSync(cachedPath) ? cachedPath : undefined;
}

function auditFigureAsset(
  figure: FigureNode,
  index: number,
  options: AssetAuditOptions,
  cacheDir: string | undefined,
  diagnostics: DiagnosticBag
): AssetAuditItem {
  const rawPath = figure.path.trim();
  const caption = inlineText(figure.caption).trim() || figure.alt.trim();

  if (options.includeCaptionDiagnostics && !caption) {
    diagnostics.warning(
      "KUI-W030",
      `La figura "${rawPath}" no tiene caption o texto alternativo.`,
      figure.position,
      "Agrega texto entre corchetes o despues de la ruta para que el PDF sea accesible."
    );
  }

  if (isRemotePath(rawPath)) {
    diagnostics.info(
      "KUI-I034",
      `Asset remoto detectado: ${rawPath}`,
      figure.position,
      "KUI lo valida como referencia externa; kui assets check lo puede cachear en build/cache/assets."
    );
    return {
      kind: "figure",
      rawPath,
      resolvedPath: rawPath,
      status: "remote",
      format: path.extname(cleanAssetPath(rawPath)).toLowerCase() || undefined,
      caption,
      sourceFile: figure.position?.file,
      line: figure.position?.line,
      position: figure.position
    };
  }

  const resolvedPath = resolveAssetPath(rawPath, { cwd: options.cwd, sourceFile: figure.position?.file });
  if (!existsSync(resolvedPath)) {
    diagnostics.warning(
      "KUI-W031",
      `La imagen no existe: ${rawPath}`,
      figure.position,
      "Puedes ponerla junto al .kui, en figuras/ o en assets/."
    );
    return {
      kind: "figure",
      rawPath,
      resolvedPath,
      status: "missing",
      format: path.extname(cleanAssetPath(rawPath)).toLowerCase() || undefined,
      caption,
      sourceFile: figure.position?.file,
      line: figure.position?.line,
      position: figure.position
    };
  }

  const format = path.extname(cleanAssetPath(resolvedPath)).toLowerCase();
  const supported = SUPPORTED_LOCAL_ASSET_EXTENSIONS.has(format);
  if (!supported) {
    diagnostics.warning(
      "KUI-W033",
      `Formato de imagen no soportado por el PDF nativo: ${rawPath}`,
      figure.position,
      "Usa PNG, JPG, JPEG o WEBP para el MVP. SVG/PDF quedan como post-MVP o requieren conversion previa."
    );
  }

  const cachePath = cacheDir ? assetCachePath(cacheDir, index, resolvedPath) : undefined;
  if (cachePath && options.ensureCache && supported) copyFileSync(resolvedPath, cachePath);
  const image = supported ? inspectImageMetadata(resolvedPath) : undefined;
  const item: AssetAuditItem = {
    kind: "figure",
    rawPath,
    resolvedPath,
    status: supported ? "ok" : "unsupported",
    format,
    image,
    caption,
    cachePath,
    sourceFile: figure.position?.file,
    line: figure.position?.line,
    position: figure.position
  };
  warnLowDpi(item, diagnostics);

  return item;
}

function collectFigures(blocks: BlockNode[]): FigureNode[] {
  const figures: FigureNode[] = [];
  const visit = (block: BlockNode): void => {
    if (block.kind === "Figure") figures.push(block);
    if (block.kind === "FencedDiv" || block.kind === "Blockquote" || block.kind === "Callout") {
      block.children.forEach(visit);
    }
  };
  blocks.forEach(visit);
  return figures;
}

function inlineText(inlines: InlineNode[]): string {
  return inlines.map((inline) => {
    if (inline.kind === "Text" || inline.kind === "InlineCode") return inline.value;
    if (inline.kind === "MathInline") return inline.content;
    if (inline.kind === "ImageInline") return inline.alt;
    if ("children" in inline && Array.isArray(inline.children)) return inlineText(inline.children);
    return "";
  }).join("");
}

function isRemotePath(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function cleanAssetPath(value: string): string {
  return value.split(/[?#]/)[0] ?? value;
}

function assetCachePath(cacheDir: string, index: number, sourcePath: string, extension = path.extname(cleanAssetPath(sourcePath))): string {
  const cleanExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const basename = path.basename(cleanAssetPath(sourcePath), path.extname(cleanAssetPath(sourcePath)))
    .replace(/[^A-Za-z0-9._-]+/g, "-") || `asset-${index + 1}`;
  const hash = createHash("sha1").update(sourcePath).digest("hex").slice(0, 8);
  return path.join(cacheDir, `${basename}-${hash}${cleanExtension}`);
}

function remoteAssetExtension(url: string, contentType: string | null): string {
  const urlExtension = path.extname(cleanAssetPath(url)).toLowerCase();
  if (SUPPORTED_LOCAL_ASSET_EXTENSIONS.has(urlExtension)) return urlExtension;
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  if (type === "image/png") return ".png";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  return urlExtension || ".asset";
}

function inspectImageMetadata(filePath: string): AssetImageMetadata | undefined {
  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    return undefined;
  }
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return inspectPngMetadata(buffer);
  if (extension === ".jpg" || extension === ".jpeg") return inspectJpegMetadata(buffer);
  if (extension === ".webp") return inspectWebpMetadata(buffer);
  return undefined;
}

function inspectPngMetadata(buffer: Buffer): AssetImageMetadata | undefined {
  if (buffer.length < 24 || buffer.toString("latin1", 1, 4) !== "PNG") return undefined;
  const metadata: AssetImageMetadata = {};
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    if (dataOffset + length > buffer.length) break;
    if (type === "IHDR" && length >= 8) {
      metadata.width = buffer.readUInt32BE(dataOffset);
      metadata.height = buffer.readUInt32BE(dataOffset + 4);
    }
    if (type === "pHYs" && length >= 9 && buffer[dataOffset + 8] === 1) {
      metadata.dpiX = pixelsPerMeterToDpi(buffer.readUInt32BE(dataOffset));
      metadata.dpiY = pixelsPerMeterToDpi(buffer.readUInt32BE(dataOffset + 4));
    }
    offset = dataOffset + length + 4;
  }
  return hasImageMetadata(metadata) ? metadata : undefined;
}

function inspectJpegMetadata(buffer: Buffer): AssetImageMetadata | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  const metadata: AssetImageMetadata = {};
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    const dataOffset = offset + 4;
    if (length < 2 || dataOffset + length - 2 > buffer.length) break;
    if (marker === 0xe0 && buffer.toString("ascii", dataOffset, dataOffset + 5) === "JFIF\0") {
      const units = buffer[dataOffset + 7];
      const xDensity = buffer.readUInt16BE(dataOffset + 8);
      const yDensity = buffer.readUInt16BE(dataOffset + 10);
      if (units === 1) {
        metadata.dpiX = xDensity;
        metadata.dpiY = yDensity;
      }
      if (units === 2) {
        metadata.dpiX = Math.round(xDensity * 2.54);
        metadata.dpiY = Math.round(yDensity * 2.54);
      }
    }
    if (isJpegStartOfFrame(marker) && length >= 7) {
      metadata.height = buffer.readUInt16BE(dataOffset + 1);
      metadata.width = buffer.readUInt16BE(dataOffset + 3);
    }
    offset = dataOffset + length - 2;
  }
  return hasImageMetadata(metadata) ? metadata : undefined;
}

function inspectWebpMetadata(buffer: Buffer): AssetImageMetadata | undefined {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return undefined;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  const dataOffset = 20;
  if (chunk === "VP8X" && buffer.length >= dataOffset + 10) {
    return {
      width: 1 + readUInt24LE(buffer, dataOffset + 4),
      height: 1 + readUInt24LE(buffer, dataOffset + 7)
    };
  }
  if (chunk === "VP8L" && buffer.length >= dataOffset + 5 && buffer[dataOffset] === 0x2f) {
    return {
      width: 1 + (((buffer[dataOffset + 2] & 0x3f) << 8) | buffer[dataOffset + 1]),
      height: 1 + (((buffer[dataOffset + 4] & 0x0f) << 10) | (buffer[dataOffset + 3] << 2) | ((buffer[dataOffset + 2] & 0xc0) >> 6))
    };
  }
  if (chunk === "VP8 " && buffer.length >= dataOffset + 10) {
    return {
      width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
      height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
    };
  }
  return undefined;
}

function warnLowDpi(item: AssetAuditItem, diagnostics: DiagnosticBag): void {
  const dpiValues = [item.image?.dpiX, item.image?.dpiY].filter((value): value is number => value !== undefined);
  if (dpiValues.length === 0) return;
  const minDpi = Math.min(...dpiValues);
  if (minDpi >= 300) return;
  diagnostics.warning(
    "KUI-W035",
    `La imagen tiene DPI bajo: ${item.rawPath} (${minDpi} dpi).`,
    item.position,
    "Para impresión académica usa al menos 300 dpi o reemplaza la figura por una versión de mayor resolución."
  );
}

function pixelsPerMeterToDpi(value: number): number {
  return Math.round(value * 0.0254);
}

function hasImageMetadata(metadata: AssetImageMetadata): boolean {
  return metadata.width !== undefined || metadata.height !== undefined || metadata.dpiX !== undefined || metadata.dpiY !== undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | ((buffer[offset + 1] ?? 0) << 8) | ((buffer[offset + 2] ?? 0) << 16);
}

function updateAssetCacheManifest(cacheDir: string, rawPath: string, cachePath: string, format: string): void {
  const manifest = readAssetCacheManifest(cacheDir);
  manifest.assets[rawPath] = {
    file: path.basename(cachePath),
    format,
    updatedAt: new Date().toISOString()
  };
  writeFileSync(path.join(cacheDir, ASSET_CACHE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readAssetCacheManifest(cacheDir: string): AssetCacheManifest {
  const manifestPath = path.join(cacheDir, ASSET_CACHE_MANIFEST);
  if (!existsSync(manifestPath)) return { version: 1, assets: {} };
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<AssetCacheManifest>;
    return parsed.version === 1 && parsed.assets && typeof parsed.assets === "object"
      ? { version: 1, assets: parsed.assets }
      : { version: 1, assets: {} };
  } catch {
    return { version: 1, assets: {} };
  }
}
