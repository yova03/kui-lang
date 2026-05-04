#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { cleanBuildDir, CompileAbortedError, compileToLatex, compileToNativePdf } from "../core/compiler.js";
import { formatDiagnostics } from "../core/diagnostics.js";
import { applyProjectConfigDefaults, readKuiProjectConfig, resolveKuiMainFile, resolveKuiOutputDir } from "../core/project.js";
import { parseKui } from "../parser/kui-parser.js";
import { validateDocument } from "../semantic/validator.js";
import { listTemplates } from "../templates/registry.js";
import { loadSourceWithIncludes } from "../utils/source-loader.js";
import { createKuiProject, KuiProjectExistsError } from "./scaffold.js";

const program = new Command();

program
  .name("kui")
  .description("KUI academic Markdown compiler")
  .version("0.1.0");

program
  .command("new")
  .argument("<name>", "project folder")
  .option("-t, --template <id>", "template id", "paper-IEEE")
  .description("Create a KUI project")
  .action((name: string, options: { template: string }) => {
    const root = path.resolve(process.cwd(), name);
    try {
      createKuiProject(root, options.template);
      console.log(`Proyecto KUI creado en ${root}`);
    } catch (error) {
      if (error instanceof KuiProjectExistsError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });

program
  .command("check")
  .argument("[file]", "KUI file")
  .option("--strict", "treat warnings as errors", false)
  .description("Validate a KUI document without rendering")
  .action((file: string | undefined, options: { strict: boolean }) => {
    const cwd = process.cwd();
    const inputFile = resolveKuiMainFile(cwd, file);
    const config = readKuiProjectConfig(cwd);
    const source = loadSourceWithIncludes(path.resolve(cwd, inputFile));
    const document = parseKui(source.content, { file: source.file });
    if (document.frontmatter) applyProjectConfigDefaults(document.frontmatter.data, config);
    document.sourceFiles = source.files;
    document.diagnostics.push(...source.diagnostics.diagnostics);
    const diagnostics = validateDocument(document, { cwd: path.dirname(source.file), strict: options.strict });
    console.log(formatDiagnostics(diagnostics.diagnostics));
    if (diagnostics.hasErrors()) process.exitCode = 1;
  });

program
  .command("build")
  .argument("[file]", "KUI file")
  .option("-o, --out-dir <dir>", "output directory")
  .option("--strict", "treat warnings as errors", false)
  .description("Compile .kui to a native PDF, without LaTeX")
  .action(async (file: string | undefined, options: { outDir?: string; strict: boolean }) => {
    const cwd = process.cwd();
    const inputFile = resolveKuiMainFile(cwd, file);
    const outputDir = resolveKuiOutputDir(cwd, options.outDir);
    try {
      const result = await compileToNativePdf(inputFile, { cwd, outputDir, strict: options.strict });
      console.log(formatDiagnostics(result.output.diagnostics));
      console.log(`\nPDF nativo generado: ${result.output.pdfPath}`);
      if (result.output.diagnostics.some((diagnostic) => diagnostic.severity === "error")) process.exitCode = 1;
    } catch (error) {
      handleCompileError(error);
    }
  });

program
  .command("pdf")
  .argument("[file]", "KUI file")
  .option("-o, --out-dir <dir>", "output directory")
  .option("--strict", "treat warnings as errors", false)
  .description("Compile .kui to a native PDF, without LaTeX")
  .action(async (file: string | undefined, options: { outDir?: string; strict: boolean }) => {
    const cwd = process.cwd();
    const inputFile = resolveKuiMainFile(cwd, file);
    const outputDir = resolveKuiOutputDir(cwd, options.outDir);
    try {
      const result = await compileToNativePdf(inputFile, { cwd, outputDir, strict: options.strict });
      console.log(formatDiagnostics(result.output.diagnostics));
      if (result.output.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        process.exitCode = 1;
        return;
      }
      console.log(`PDF nativo generado: ${result.output.pdfPath}`);
    } catch (error) {
      handleCompileError(error);
    }
  });

program
  .command("templates")
  .description("List built-in templates")
  .action(() => {
    for (const template of listTemplates()) {
      console.log(`${template.id}\t${template.name}\tengine=${template.pdfEngine}`);
    }
  });

program
  .command("clean")
  .option("-o, --out-dir <dir>", "output directory")
  .description("Remove generated build artifacts")
  .action((options: { outDir?: string }) => {
    const cwd = process.cwd();
    const outputDir = resolveKuiOutputDir(cwd, options.outDir);
    cleanBuildDir(cwd, outputDir);
    console.log(`Build limpiado: ${path.resolve(cwd, outputDir)}`);
  });

program
  .command("watch")
  .argument("[file]", "KUI file")
  .option("-o, --out-dir <dir>", "output directory")
  .description("Watch a KUI file and rebuild native PDF on changes")
  .action((file: string | undefined, options: { outDir?: string }) => {
    const cwd = process.cwd();
    const watchers = new Map<string, FSWatcher>();
    let timer: NodeJS.Timeout | undefined;

    const rebuild = async () => {
      const inputFile = resolveKuiMainFile(cwd, file);
      const outputDir = resolveKuiOutputDir(cwd, options.outDir);
      try {
        const result = await compileToNativePdf(inputFile, { cwd, outputDir });
        syncWatchers(cwd, file, result.output.sourceFiles, watchers, scheduleRebuild);
        console.log(`[kui watch] ${new Date().toLocaleTimeString()} -> ${result.output.pdfPath}`);
      } catch (error) {
        console.error(formatWatchError(error));
        syncWatchers(cwd, file, [path.resolve(cwd, inputFile)], watchers, scheduleRebuild);
      }
    };

    const scheduleRebuild = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 120);
    };

    void rebuild();
    console.log(`Observando proyecto KUI en ${cwd}. Ctrl+C para salir.`);
  });

program
  .command("doctor")
  .description("Check local KUI native PDF dependencies")
  .action(() => {
    const checks = [
      ["node", process.version],
      ["native-pdf", "pdfkit"],
      ["latex-export-pdflatex", commandVersion("pdflatex")],
      ["latex-export-biber", commandVersion("biber")]
    ];
    for (const [name, status] of checks) {
      console.log(`${status ? "OK  " : "WARN"} ${name}${status ? `: ${status}` : " no encontrado"}`);
    }
    console.log("Templates:");
    for (const template of listTemplates()) console.log(`OK   ${template.id}`);
  });

program
  .command("export")
  .argument("[file]", "KUI file")
  .requiredOption("-f, --format <format>", "tex|pandoc|html|epub|docx")
  .option("-o, --out-dir <dir>", "output directory")
  .description("Export a KUI document")
  .action((file: string | undefined, options: { format: string; outDir?: string }) => {
    if (options.format !== "tex") {
      console.error(`Export ${options.format} está reservado para backends futuros. Usa --format tex en v0.x.`);
      process.exitCode = 1;
      return;
    }
    const cwd = process.cwd();
    const inputFile = resolveKuiMainFile(cwd, file);
    const outputDir = resolveKuiOutputDir(cwd, options.outDir);
    const result = compileToLatex(inputFile, { cwd, outputDir });
    console.log(`Export TEX: ${result.output.artifacts.texPath}`);
  });

program
  .command("import")
  .argument("<file>", "source file")
  .option("-o, --out <file>", "output .kui file")
  .description("Import Markdown-like sources into KUI")
  .action((file: string, options: { out?: string }) => {
    const absolute = path.resolve(process.cwd(), file);
    const ext = path.extname(absolute).toLowerCase();
    const out = path.resolve(process.cwd(), options.out ?? `${path.basename(absolute, ext)}.kui`);
    if (!existsSync(absolute)) {
      console.error(`No existe: ${absolute}`);
      process.exitCode = 1;
      return;
    }
    if (ext === ".kui" || ext === ".md") {
      copyFileSync(absolute, out);
      console.log(`Importado: ${out}`);
      return;
    }
    console.error("Import avanzado (.tex, .docx, .ipynb) queda como fase 8.5; este MVP importa .md/.kui.");
    process.exitCode = 1;
  });

const bib = program.command("bib").description("Bibliography helpers");

bib
  .command("add")
  .argument("<doi>", "DOI to fetch")
  .option("-o, --out <file>", "BibTeX output file", "referencias.bib")
  .description("Fetch a BibTeX entry by DOI and append it")
  .action(async (doi: string, options: { out: string }) => {
    const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
      headers: { Accept: "application/x-bibtex" }
    });
    if (!response.ok) {
      console.error(`No se pudo descargar BibTeX para DOI ${doi}: HTTP ${response.status}`);
      process.exitCode = 1;
      return;
    }
    const bibtex = await response.text();
    const out = path.resolve(process.cwd(), options.out);
    writeFileSync(out, `${existsSync(out) && statSync(out).size > 0 ? "\n" : ""}${bibtex.trim()}\n`, {
      encoding: "utf8",
      flag: "a"
    });
    console.log(`Entrada agregada a ${out}`);
  });

program.parse();

function splitCommand(step: string): string[] {
  return step.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

function commandVersion(command: string): string | undefined {
  try {
    return execFileSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")[0]
      .trim();
  } catch {
    return undefined;
  }
}

function syncWatchers(
  cwd: string,
  explicitFile: string | undefined,
  sourceFiles: string[],
  watchers: Map<string, FSWatcher>,
  onChange: () => void
): void {
  const targets = new Set(sourceFiles.map((file) => path.resolve(file)));
  const configPath = path.resolve(cwd, "kui.toml");
  if (!explicitFile && existsSync(configPath)) targets.add(configPath);

  for (const [file, watcher] of watchers) {
    if (!targets.has(file)) {
      watcher.close();
      watchers.delete(file);
    }
  }

  for (const file of targets) {
    if (!watchers.has(file) && existsSync(file)) {
      watchers.set(file, watch(file, { persistent: true }, onChange));
    }
  }
}

function formatWatchError(error: unknown): string {
  if (error instanceof CompileAbortedError) return formatDiagnostics(error.diagnostics);
  return error instanceof Error ? error.message : String(error);
}

function handleCompileError(error: unknown): void {
  if (error instanceof CompileAbortedError) {
    console.log(formatDiagnostics(error.diagnostics));
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
