import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emitLatex, type LatexOutput } from "../latex/emitter.js";
import { parseKui } from "../parser/kui-parser.js";
import { emitNativePdf, type NativePdfOutput } from "../pdf/native-pdf.js";
import { validateDocument } from "../semantic/validator.js";
import { loadSourceWithIncludes } from "../utils/source-loader.js";
import type { Diagnostic } from "./diagnostics.js";
import type { CompileOptions } from "./project.js";

export interface CompileResult {
  output: LatexOutput;
  wroteTex: boolean;
}

export interface NativeCompileResult {
  output: NativePdfOutput;
}

export class CompileAbortedError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super("KUI compilation aborted due to errors.");
  }
}

export function compileToLatex(inputFile: string, options: Partial<CompileOptions> = {}): CompileResult {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = path.resolve(cwd, options.outputDir ?? "build");
  const source = loadSourceWithIncludes(path.resolve(cwd, inputFile));
  const document = parseKui(source.content, { file: source.file });
  document.sourceFiles = source.files;
  document.diagnostics.push(...source.diagnostics.diagnostics);

  const validation = validateDocument(document, { cwd: path.dirname(source.file), strict: options.strict });
  document.diagnostics = validation.diagnostics;
  if (validation.hasErrors()) throw new CompileAbortedError(validation.diagnostics);
  mkdirSync(outputDir, { recursive: true });

  const output = emitLatex(document, {
    cwd,
    outputDir,
    target: options.target ?? "tex",
    strict: options.strict,
    pdfEngine: options.pdfEngine
  });
  writeFileSync(output.artifacts.texPath, output.tex, "utf8");
  return { output, wroteTex: true };
}

export async function compileToNativePdf(inputFile: string, options: Partial<CompileOptions> = {}): Promise<NativeCompileResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = path.resolve(cwd, options.outputDir ?? "build");
  const source = loadSourceWithIncludes(path.resolve(cwd, inputFile));
  const document = parseKui(source.content, { file: source.file });
  document.sourceFiles = source.files;
  document.diagnostics.push(...source.diagnostics.diagnostics);

  const validation = validateDocument(document, { cwd: path.dirname(source.file), strict: options.strict });
  document.diagnostics = validation.diagnostics;
  if (validation.hasErrors()) throw new CompileAbortedError(validation.diagnostics);
  mkdirSync(outputDir, { recursive: true });

  const output = await emitNativePdf(document, {
    cwd,
    outputDir,
    target: "pdf",
    strict: options.strict
  });
  return { output };
}

export function cleanBuildDir(cwd: string, outputDir = "build"): void {
  rmSync(path.resolve(cwd, outputDir), { force: true, recursive: true });
}
