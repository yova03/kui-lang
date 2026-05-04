import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseKui } from "../src/parser/kui-parser.js";
import { validateDocument } from "../src/semantic/validator.js";

describe("validateDocument", () => {
  it("rejects unknown templates", () => {
    const document = parseKui("---\ntitle: Test\ntemplate: no-existe\n---\n\nTexto.\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd() });

    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain("KUI-E060");
  });

  it("suggests close template ids", () => {
    const document = parseKui("---\ntitle: Test\ntemplate: paper-AP\n---\n\nTexto.\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd() });
    const diagnostic = diagnostics.diagnostics.find((item) => item.code === "KUI-E060");

    expect(diagnostic?.hint).toContain("paper-APA");
  });

  it("requires template frontmatter fields", () => {
    const document = parseKui("---\ntitle: Tesis\ntemplate: tesis-unsaac\n---\n\nTexto.\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd() });

    expect(diagnostics.diagnostics.filter((diagnostic) => diagnostic.code === "KUI-E061")).toHaveLength(6);
  });

  it("warns when a cross reference points to a label of another type", () => {
    const document = parseKui("---\ntitle: Test\ntemplate: paper-APA\n---\n\nVer @eq:foto.\n\n![Foto](foto.png) {#eq:foto}\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd() });

    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain("KUI-W003");
  });

  it("suggests close labels for broken references", () => {
    const document = parseKui("---\ntitle: Test\nauthor: A\ntemplate: paper-APA\n---\n\nVer @fig:map.\n\n![Mapa](mapa.png) {#fig:mapa}\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd(), checks: ["refs"] });
    const diagnostic = diagnostics.diagnostics.find((item) => item.code === "KUI-W002");

    expect(diagnostic?.hint).toContain("@fig:mapa");
  });

  it("accepts valid table refs without cross-ref warnings", () => {
    const document = parseKui("---\ntitle: Test\nauthor: A\ntemplate: paper-APA\n---\n\nVer @tbl:datos.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n: Datos {#tbl:datos}\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd() });
    const codes = diagnostics.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("KUI-W002");
    expect(codes).not.toContain("KUI-W003");
  });

  it("warns about uneven table rows", () => {
    const document = parseKui("---\ntitle: Test\nauthor: A\ntemplate: paper-APA\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n");
    const diagnostics = validateDocument(document, { cwd: process.cwd() });

    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain("KUI-W032");
  });

  it("runs only selected validation subsets", () => {
    const document = parseKui([
      "---",
      "title: Test",
      "author: A",
      "template: paper-APA",
      "---",
      "",
      "Ver @fig:no-existe y @missing2026.",
      "",
      "![](missing.png)",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 | 3 |",
      "",
      "# Intro",
      "",
      "### Heading saltado"
    ].join("\n"));

    const refs = validateDocument(document, { cwd: process.cwd(), checks: ["refs"] });
    expect(refs.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["KUI-W002"]);

    const assets = validateDocument(document, { cwd: process.cwd(), checks: ["assets"] });
    expect(assets.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["KUI-W031"]);

    const accessibility = validateDocument(document, { cwd: process.cwd(), checks: ["accessibility"] });
    expect(accessibility.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["KUI-W030", "KUI-W040"]);
  });

  it("accepts citations declared in KUIRef files", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-kref-"));
    writeFileSync(path.join(cwd, "referencias.kref"), "garcia2020:\n  title: Wari en Cusco\n  author:\n    - Ana García\n  year: 2020\n", "utf8");
    const document = parseKui("---\ntitle: Test\nauthor: A\ntemplate: paper-APA\nrefs: ./referencias.kref\n---\n\nSegún @garcia2020, KUIRef funciona.\n");
    const diagnostics = validateDocument(document, { cwd });
    const codes = diagnostics.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("KUI-W001");
    expect(codes).not.toContain("KUI-W021");
    expect(document.symbols.bibliographyKeys.has("garcia2020")).toBe(true);
  });

  it("suggests close citation keys", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-kref-"));
    writeFileSync(path.join(cwd, "referencias.kref"), "garcia2020:\n  title: Wari en Cusco\n  author:\n    - Ana Garcia\n  year: 2020\n", "utf8");
    const document = parseKui("---\ntitle: Test\nauthor: A\ntemplate: paper-APA\nrefs: ./referencias.kref\n---\n\nSegun @garcia202, KUIRef sugiere claves cercanas.\n");
    const diagnostics = validateDocument(document, { cwd });
    const diagnostic = diagnostics.diagnostics.find((item) => item.code === "KUI-W001");

    expect(diagnostic?.hint).toContain("@garcia2020");
  });
});
