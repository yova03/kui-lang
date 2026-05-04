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
});
