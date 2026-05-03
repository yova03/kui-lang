#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

interface QaResult {
  pdf: string;
  pages: number;
  bytes: number;
  preview?: string;
  previewBytes?: number;
  previewWidth?: number;
  previewHeight?: number;
  ok: boolean;
  checks: string[];
}

const args = process.argv.slice(2);
const pdfArg = args.find((arg) => !arg.startsWith("--"));
const outIndex = args.indexOf("--out-dir");
const outDir = path.resolve(process.cwd(), outIndex >= 0 ? args[outIndex + 1] : "build/qa");

if (!pdfArg) {
  console.error("Uso: npm run qa:pdf -- <archivo.pdf> [--out-dir build/qa]");
  process.exit(1);
}

const pdfPath = path.resolve(process.cwd(), pdfArg);
const result = runVisualQa(pdfPath, outDir);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function runVisualQa(pdfPathValue: string, outputDir: string): QaResult {
  const checks: string[] = [];
  if (!existsSync(pdfPathValue)) throw new Error(`No existe el PDF: ${pdfPathValue}`);
  const bytes = readFileSync(pdfPathValue);
  if (bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("El archivo no inicia con firma %PDF.");
  checks.push("firma-pdf");
  const pages = bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages < 1) throw new Error("No se detectaron paginas PDF.");
  checks.push("paginas");

  const result: QaResult = { pdf: pdfPathValue, pages, bytes: bytes.byteLength, ok: true, checks };
  const qlmanage = commandAvailable("qlmanage");
  const sips = commandAvailable("sips");
  if (!qlmanage || !sips) {
    result.ok = false;
    result.checks.push("preview-no-disponible");
    return result;
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "kui-pdf-qa-"));
  execFileSync("qlmanage", ["-t", "-s", "1400", "-o", tmp, pdfPathValue], { stdio: "ignore" });
  const preview = readdirSync(tmp).find((file) => file.toLowerCase().endsWith(".png"));
  if (!preview) throw new Error("No se pudo generar preview PNG con qlmanage.");

  mkdirSync(outputDir, { recursive: true });
  const sourcePreview = path.join(tmp, preview);
  const targetPreview = path.join(outputDir, `${path.basename(pdfPathValue, ".pdf")}-preview.png`);
  copyFileSync(sourcePreview, targetPreview);

  const previewBytes = statSync(targetPreview).size;
  const dimensions = pngDimensions(targetPreview);
  if (previewBytes < 10_000) throw new Error("El preview pesa demasiado poco; posible pagina en blanco.");
  if (dimensions.width < 300 || dimensions.height < 300) throw new Error("El preview generado es demasiado pequeño.");
  result.preview = targetPreview;
  result.previewBytes = previewBytes;
  result.previewWidth = dimensions.width;
  result.previewHeight = dimensions.height;
  result.checks.push("preview-png", "preview-no-vacio");
  return result;
}

function commandAvailable(command: string): boolean {
  try {
    execFileSync("/usr/bin/which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pngDimensions(file: string): { width: number; height: number } {
  const output = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
  return { width, height };
}
