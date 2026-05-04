import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PdfKitNativeEngine } from "../src/engine/native-engine.js";
import { emitNativePdf } from "../src/pdf/native-pdf.js";
import { parseKui } from "../src/parser/kui-parser.js";
import { auditAndCacheDocumentAssets } from "../src/semantic/assets.js";

describe("emitNativePdf", () => {
  it("writes a native PDF without LaTeX", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-pdf-"));
    const doc = parseKui(`---\ntitle: Test\nauthor: A\ntemplate: paper-APA\n---\n\n# Intro\nTexto PDF nativo con nota[^n1] y @eq:x.\n\n$$x=1$$ {#eq:x}\n\n[^n1]: Nota conservada.\n`);
    doc.sourceFiles = [path.join(outDir, "input.kui")];
    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const bytes = readFileSync(output.pdfPath);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(Buffer.from(output.pdfBytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(output.pageMap.labels["eq:x"].page).toBe(1);
    expect(output.pageMap.footnotes).toEqual([{ id: "n1", number: 1, page: 1 }]);
    expect(output.diagnostics).toHaveLength(0);
  });

  it("renders footnotes on the same page instead of appending a notes page", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-footnote-"));
    const doc = parseKui(`---\ntitle: Nota\nauthor: A\ntemplate: paper-APA\n---\n\nTexto breve con nota[^n1].\n\n[^n1]: Nota al pie en la misma pagina.\n`);
    doc.sourceFiles = [path.join(outDir, "footnote.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const bytes = readFileSync(output.pdfPath);

    expect(countPdfPages(bytes)).toBe(1);
    expect(output.pageMap.footnotes).toEqual([{ id: "n1", number: 1, page: 1 }]);
    expect(output.diagnostics).toHaveLength(0);
  });

  it("returns bytes through the native engine interface", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-engine-"));
    const doc = parseKui(`---\ntitle: Engine\ntemplate: paper-APA\n---\n\n# Intro\nPDF por interfaz nativa.\n`);
    doc.sourceFiles = [path.join(outDir, "engine.kui")];

    const result = await new PdfKitNativeEngine({ cwd: outDir, outputDir: outDir, target: "pdf" }).render(doc);

    expect(Buffer.from(result.pdfBytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("renders remote figures from the prepared asset cache", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-remote-image-"));
    const remoteUrl = "https://example.com/remote-figure.png";
    const doc = parseKui(`---\ntitle: Remota\nauthor: A\ntemplate: paper-APA\n---\n\n![Figura remota](${remoteUrl}) {#fig:remote}\n`, {
      file: path.join(outDir, "remote.kui")
    });
    doc.sourceFiles = [path.join(outDir, "remote.kui")];
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");

    await auditAndCacheDocumentAssets(doc, {
      cwd: outDir,
      outputDir: outDir,
      ensureCache: true,
      fetchRemote: true,
      fetchImpl: async () => new Response(png, {
        status: 200,
        headers: { "content-type": "image/png" }
      })
    });
    doc.diagnostics = [];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });

    expect(readFileSync(output.pdfPath).subarray(0, 4).toString()).toBe("%PDF");
    expect(output.pageMap.labels["fig:remote"].page).toBeGreaterThan(0);
    expect(output.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("KUI-W090");
  });

  it("suggests the asset cache command when a remote figure is not cached", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-remote-missing-cache-"));
    const doc = parseKui("---\ntitle: Remota\nauthor: A\ntemplate: paper-APA\n---\n\n![Figura remota](https://example.com/remote-figure.png) {#fig:remote}\n", {
      file: path.join(outDir, "remote.kui")
    });
    doc.sourceFiles = [path.join(outDir, "remote.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const diagnostic = output.diagnostics.find((item) => item.code === "KUI-W090");

    expect(diagnostic?.hint).toContain("kui assets check");
  });

  it("records real heading pages for generated table of contents", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-toc-"));
    const doc = parseKui(`---\ntitle: Indice\nauthor: A\ntemplate: paper-APA\n---\n\n:indice\n\n:nuevapagina\n\n# Uno {#sec:uno}\nTexto.\n\n:nuevapagina\n\n# Dos {#sec:dos}\nTexto.\n`);
    doc.sourceFiles = [path.join(outDir, "toc.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });

    expect(output.pageMap.headings.map((heading) => [heading.title, heading.page])).toEqual([
      ["Uno", 2],
      ["Dos", 3]
    ]);
    expect(output.pageMap.labels["sec:uno"].page).toBe(2);
    expect(output.pageMap.labels["sec:dos"].page).toBe(3);
  });

  it("creates internal PDF links and excludes ficha headings from thesis indexes", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-linked-toc-"));
    writeFileSync(
      path.join(outDir, "pixel.png"),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
    );
    const longHeading = "Segunda recomendación con título extenso para comprobar que el índice UNSAAC envuelve la línea sin invadir los puntos guía ni el número de página";
    const longTableCaption = "Tabla enlazada con una leyenda académica extensa para probar que el índice de tablas se compone en varias líneas sin solaparse con los números de página";
    const longFigureCaption = "Figura enlazada con una descripción prolongada del sitio arqueológico de Ayallacta, fuente de elaboración propia y validación de campo 2024";
    const doc = parseKui(`---\ntitle: Indice tesis\nauthor: A\ntemplate: tesis-unsaac\nasesor: B\ninstitucion: C\nfacultad: D\n---\n\n:indice\n:tablas\n:figuras\n\n# Capitulo uno {.chapter #ch:uno}\nTexto.\n\n## ${longHeading} {#sec:larga}\nTexto.\n\n| Campo | Dato |\n| :-- | :-- |\n| Uno | Dos |\n: ${longTableCaption} {#tbl:uno}\n\n![${longFigureCaption}](pixel.png) {#fig:larga}\n\n:::ficha-registro {#ficha-prueba title="Ficha prueba"}\n\n## Ficha interna {.notoc}\n\n### 1. Identificacion {.notoc}\n\n| Campo | Dato |\n| :-- | :-- |\n| Registro grafico | Pendiente |\n\n:::\n\n# Capitulo dos {.chapter #ch:dos}\nTexto.\n`);
    doc.sourceFiles = [path.join(outDir, "linked-toc.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const text = readFileSync(output.pdfPath, "latin1");

    expect(output.pageMap.headings.map((heading) => heading.title)).toEqual(["Capitulo uno", longHeading, "Capitulo dos"]);
    expect(output.pageMap.labels["sec:larga"].page).toBeGreaterThan(0);
    expect(output.pageMap.labels["tbl:uno"].page).toBeGreaterThan(0);
    expect(output.pageMap.labels["fig:larga"].page).toBeGreaterThan(0);
    expect(text).toContain("/S /GoTo");
    expect(text.match(/\/Subtype \/Link/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(output.diagnostics).toHaveLength(0);
  });

  it("paginates long tables and keeps the output valid", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-table-"));
    const rows = Array.from({ length: 72 }, (_unused, index) =>
      `| Sitio ${index + 1} | ${2020 + (index % 6)} | Observacion extensa con contenido que debe envolver dentro de la celda sin invadir los margenes ni recortarse verticalmente |`
    ).join("\n");
    const doc = parseKui(`---\ntitle: Tabla larga\nauthor: A\ntemplate: tesis-unsaac\nasesor: B\ninstitucion: C\nfacultad: D\n---\n\n# Datos\nVer @tbl:larga.\n\n| Sitio | Año | Observación |\n| :--- | ---: | :--- |\n${rows}\n: Tabla larga de prueba {#tbl:larga}\n`);
    doc.sourceFiles = [path.join(outDir, "tabla.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const bytes = readFileSync(output.pdfPath);

    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(countPdfPages(bytes)).toBeGreaterThan(1);
    expect(output.diagnostics).toHaveLength(0);
  });

  it("keeps dense wide tables within a valid multi-page PDF", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-wide-table-"));
    const headers = ["Proceso", "Expediente", "Estado", "Riesgo", "Responsable", "Seguimiento", "Proxima accion", "Observacion"];
    const divider = headers.map(() => ":---").join(" | ");
    const rows = Array.from({ length: 34 }, (_unused, index) => (
      `| Proceso-${index + 1} | 2026-${String(index + 1).padStart(7, "0")} | En seguimiento con texto largo | Alto | Equipo ${index % 5} | Llamadas, cargos, anexos y trazabilidad documental completa | Reiterar respuesta formal y consolidar evidencia antes del cierre | PalabraSuperLargaSinEspaciosParaForzarCorte${index} |`
    )).join("\n");
    const doc = parseKui(`---\ntitle: Tabla densa\nauthor: A\ntemplate: informe-operativo\nsubtitle: Prueba\norganization: KUI\nperiod: Mayo\n---\n\n# Tabla critica\n\n| ${headers.join(" | ")} |\n| ${divider} |\n${rows}\n: Tabla densa {#tbl:densa}\n`);
    doc.sourceFiles = [path.join(outDir, "wide-table.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const bytes = readFileSync(output.pdfPath);

    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(countPdfPages(bytes)).toBeGreaterThan(2);
    expect(output.pageMap.labels["tbl:densa"].page).toBeGreaterThan(1);
    expect(output.diagnostics).toHaveLength(0);
  });

  it("renders operational semantic blocks in the native PDF compiler", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-operational-"));
    const doc = parseKui(`---\ntitle: Operativo\ntemplate: informe-operativo\nauthor: Equipo\n---\n\n:::resumen-operativo\nResumen ejecutivo con control de margen.\n:::\n\n:::kpi-grid\n- 12 cierres oficiales\n- 22 envios GD\n:::\n\n:::matriz-riesgo\n| Riesgo | Impacto | Prioridad | Accion |\n| :--- | :--- | :--- | :--- |\n| Vigencia | Bloquea tramite | Critica | Actualizar documento |\n:::\n\n:::cronograma\n- 02 mayo: Validar vigencia\n- 04 mayo: Reingresar solicitud\n:::\n\n:::firma\n- Equipo de Operaciones | Responsable\n- Direccion | Conforme\n:::\n`);
    doc.sourceFiles = [path.join(outDir, "operativo.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const bytes = readFileSync(output.pdfPath);

    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(Buffer.from(output.pdfBytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(output.diagnostics).toHaveLength(0);
  });

  it("renders bibliography entries from KUIRef files", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kui-kref-pdf-"));
    writeFileSync(path.join(outDir, "referencias.kref"), "garcia2020:\n  type: article\n  title: Wari en Cusco\n  author:\n    - Ana García\n  year: 2020\n  journal: Revista Andina\n", "utf8");
    const doc = parseKui(`---\ntitle: KUIRef\nauthor: A\ntemplate: paper-APA\nrefs: ./referencias.kref\n---\n\nSegún @garcia2020, KUIRef reemplaza BibTeX para documentos nativos.\n\n:bibliografia\n`);
    doc.sourceFiles = [path.join(outDir, "kref.kui")];

    const output = await emitNativePdf(doc, { cwd: outDir, outputDir: outDir, target: "pdf" });
    const bytes = readFileSync(output.pdfPath);

    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(countPdfPages(bytes)).toBeGreaterThan(1);
    expect(output.diagnostics).toHaveLength(0);
  });
});

function countPdfPages(bytes: Buffer): number {
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}
