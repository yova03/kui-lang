import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createKuiProject } from "../src/cli/scaffold.js";
import { CompileAbortedError, compileToNativePdf } from "../src/core/compiler.js";
import { readKuiProjectConfig, resolveKuiMainFile, resolveKuiOutputDir } from "../src/core/project.js";
import { loadSourceWithIncludes } from "../src/utils/source-loader.js";

describe("compileToNativePdf", () => {
  it("aborts before rendering when the input cannot be read", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-missing-"));

    await expect(compileToNativePdf("does-not-exist.kui", { cwd, outputDir: "build" }))
      .rejects.toBeInstanceOf(CompileAbortedError);

    expect(existsSync(path.join(cwd, "build", "does-not-exist.pdf"))).toBe(false);
  });

  it("compiles a modular tesis-unsaac scaffold from main.kui includes", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-tesis-scaffold-"));
    const projectRoot = path.join(cwd, "mi-tesis");
    createKuiProject(projectRoot, "tesis-unsaac");

    expect(existsSync(path.join(projectRoot, "main.kui"))).toBe(true);
    expect(existsSync(path.join(projectRoot, "contenido", "cap1_planteamiento_del_problema.kui"))).toBe(true);
    expect(existsSync(path.join(projectRoot, "referencias.kref"))).toBe(true);

    const result = await compileToNativePdf("main.kui", { cwd: projectRoot, outputDir: "build" });

    expect(existsSync(result.output.pdfPath)).toBe(true);
    expect(result.output.diagnostics).toHaveLength(0);
    expect(result.output.sourceFiles.map((file) => path.basename(file))).toContain("cap1_planteamiento_del_problema.kui");
    expect(result.output.pageMap.headings.map((heading) => heading.title)).toContain("Planteamiento del problema");
  });

  it("expands Spanish :incluir directives before parsing", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-incluir-"));
    mkdirSync(path.join(cwd, "contenido"));
    writeFileSync(path.join(cwd, "main.kui"), ":incluir contenido/marco_teorico.kui\n", "utf8");
    writeFileSync(path.join(cwd, "contenido", "marco_teorico.kui"), "# Marco teórico\n", "utf8");

    const source = loadSourceWithIncludes(path.join(cwd, "main.kui"));

    expect(source.diagnostics.hasErrors()).toBe(false);
    expect(source.content).toContain("# Marco teórico");
    expect(source.files.map((file) => path.basename(file))).toEqual(["main.kui", "marco_teorico.kui"]);
  });

  it("expands easy incluir directives without colon", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-incluir-easy-"));
    mkdirSync(path.join(cwd, "contenido"));
    writeFileSync(path.join(cwd, "main.kui"), "incluir contenido/resultados.kui\n", "utf8");
    writeFileSync(path.join(cwd, "contenido", "resultados.kui"), "# Resultados\n", "utf8");

    const source = loadSourceWithIncludes(path.join(cwd, "main.kui"));

    expect(source.diagnostics.hasErrors()).toBe(false);
    expect(source.content).toContain("# Resultados");
  });


  it("reports missing and cyclic includes", () => {
    const missingRoot = mkdtempSync(path.join(tmpdir(), "kui-missing-include-"));
    writeFileSync(path.join(missingRoot, "main.kui"), ":incluir contenido/no-existe.kui\n", "utf8");

    const missing = loadSourceWithIncludes(path.join(missingRoot, "main.kui"));
    expect(missing.diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain("KUI-E051");

    const cycleRoot = mkdtempSync(path.join(tmpdir(), "kui-cycle-include-"));
    writeFileSync(path.join(cycleRoot, "main.kui"), ":incluir capitulo.kui\n", "utf8");
    writeFileSync(path.join(cycleRoot, "capitulo.kui"), ":incluir main.kui\n", "utf8");

    const cyclic = loadSourceWithIncludes(path.join(cycleRoot, "main.kui"));
    expect(cyclic.diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain("KUI-E050");
  });

  it("resolves project defaults from kui.toml", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-project-config-"));
    writeFileSync(path.join(cwd, "kui.toml"), "main = \"contenido/tesis.kui\"\nbuildDir = \"salida\"\ntemplate = \"tesis-unsaac\"\n", "utf8");

    expect(readKuiProjectConfig(cwd)).toEqual({
      main: "contenido/tesis.kui",
      buildDir: "salida",
      template: "tesis-unsaac"
    });
    expect(resolveKuiMainFile(cwd)).toBe("contenido/tesis.kui");
    expect(resolveKuiMainFile(cwd, "otro.kui")).toBe("otro.kui");
    expect(resolveKuiOutputDir(cwd)).toBe("salida");
    expect(resolveKuiOutputDir(cwd, "build-custom")).toBe("build-custom");
  });
});
