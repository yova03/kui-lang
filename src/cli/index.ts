#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { cleanBuildDir, CompileAbortedError, compileToLatex, compileToNativePdf } from "../core/compiler.js";
import { formatDiagnostics } from "../core/diagnostics.js";
import { parseKui } from "../parser/kui-parser.js";
import { validateDocument } from "../semantic/validator.js";
import { listTemplates } from "../templates/registry.js";
import { loadSourceWithIncludes } from "../utils/source-loader.js";

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
    if (existsSync(root)) {
      console.error(`Ya existe: ${root}`);
      process.exitCode = 1;
      return;
    }
    mkdirSync(path.join(root, "figuras"), { recursive: true });
    mkdirSync(path.join(root, "capitulos"), { recursive: true });
    writeFileSync(path.join(root, "kui.toml"), `main = "main.kui"\ntemplate = "${options.template}"\n`, "utf8");
    writeFileSync(path.join(root, "referencias.kref"), sampleKref(), "utf8");
    writeFileSync(path.join(root, "main.kui"), sampleDocument(options.template), "utf8");
    console.log(`Proyecto KUI creado en ${root}`);
  });

program
  .command("check")
  .argument("[file]", "KUI file", "main.kui")
  .option("--strict", "treat warnings as errors", false)
  .description("Validate a KUI document without rendering")
  .action((file: string, options: { strict: boolean }) => {
    const source = loadSourceWithIncludes(path.resolve(process.cwd(), file));
    const document = parseKui(source.content, { file: source.file });
    document.sourceFiles = source.files;
    document.diagnostics.push(...source.diagnostics.diagnostics);
    const diagnostics = validateDocument(document, { cwd: path.dirname(source.file), strict: options.strict });
    console.log(formatDiagnostics(diagnostics.diagnostics));
    if (diagnostics.hasErrors()) process.exitCode = 1;
  });

program
  .command("build")
  .argument("[file]", "KUI file", "main.kui")
  .option("-o, --out-dir <dir>", "output directory", "build")
  .option("--strict", "treat warnings as errors", false)
  .description("Compile .kui to a native PDF, without LaTeX")
  .action(async (file: string, options: { outDir: string; strict: boolean }) => {
    try {
      const result = await compileToNativePdf(file, { cwd: process.cwd(), outputDir: options.outDir, strict: options.strict });
      console.log(formatDiagnostics(result.output.diagnostics));
      console.log(`\nPDF nativo generado: ${result.output.pdfPath}`);
      if (result.output.diagnostics.some((diagnostic) => diagnostic.severity === "error")) process.exitCode = 1;
    } catch (error) {
      handleCompileError(error);
    }
  });

program
  .command("pdf")
  .argument("[file]", "KUI file", "main.kui")
  .option("-o, --out-dir <dir>", "output directory", "build")
  .option("--strict", "treat warnings as errors", false)
  .description("Compile .kui to a native PDF, without LaTeX")
  .action(async (file: string, options: { outDir: string; strict: boolean }) => {
    try {
      const result = await compileToNativePdf(file, { cwd: process.cwd(), outputDir: options.outDir, strict: options.strict });
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
  .option("-o, --out-dir <dir>", "output directory", "build")
  .description("Remove generated build artifacts")
  .action((options: { outDir: string }) => {
    cleanBuildDir(process.cwd(), options.outDir);
    console.log(`Build limpiado: ${path.resolve(process.cwd(), options.outDir)}`);
  });

program
  .command("watch")
  .argument("[file]", "KUI file", "main.kui")
  .option("-o, --out-dir <dir>", "output directory", "build")
  .description("Watch a KUI file and rebuild native PDF on changes")
  .action((file: string, options: { outDir: string }) => {
    const absolute = path.resolve(process.cwd(), file);
    const rebuild = () => {
      try {
        compileToNativePdf(file, { cwd: process.cwd(), outputDir: options.outDir })
          .then((result) => console.log(`[kui watch] ${new Date().toLocaleTimeString()} -> ${result.output.pdfPath}`))
          .catch((error) => console.error(error instanceof Error ? error.message : error));
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    };
    rebuild();
    console.log(`Observando ${absolute}. Ctrl+C para salir.`);
    watch(absolute, { persistent: true }, rebuild);
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
  .argument("[file]", "KUI file", "main.kui")
  .requiredOption("-f, --format <format>", "tex|pandoc|html|epub|docx")
  .option("-o, --out-dir <dir>", "output directory", "build")
  .description("Export a KUI document")
  .action((file: string, options: { format: string; outDir: string }) => {
    if (options.format !== "tex") {
      console.error(`Export ${options.format} está reservado para backends futuros. Usa --format tex en v0.x.`);
      process.exitCode = 1;
      return;
    }
    const result = compileToLatex(file, { cwd: process.cwd(), outputDir: options.outDir });
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

function sampleKref(): string {
  return `garcia2020:\n  type: article\n  title: Wari en Cusco\n  author:\n    - Ana García\n  year: 2020\n  journal: Revista Andina\n`;
}

function sampleDocument(template: string): string {
  return `---\ntitle: "Documento KUI de ejemplo"\nauthor: "Daril Yovani Cabrera"\ndate: 2026\nlanguage: es\ntemplate: ${template}\nrefs: ./referencias.kref\ncsl: apa.csl\n---\n\n:::resumen\nEste documento demuestra la sintaxis KUI mínima para un trabajo académico.\n:::\n\n:indice\n\n# Introducción {#sec:intro}\nSegún @garcia2020, KUI permite escribir documentos académicos con menos fricción.\n\nVer la ecuación @eq:rho.\n\n$$\n\\rho = \\frac{n}{V}\n$$ {#eq:rho}\n\n:::nota\nLos bloques de nota se renderizan como callouts.\n:::\n\n:bibliografia\n`;
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

function handleCompileError(error: unknown): void {
  if (error instanceof CompileAbortedError) {
    console.log(formatDiagnostics(error.diagnostics));
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
