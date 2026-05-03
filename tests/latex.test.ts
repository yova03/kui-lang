import { describe, expect, it } from "vitest";
import { emitLatex } from "../src/latex/emitter.js";
import { parseKui } from "../src/parser/kui-parser.js";

describe("emitLatex", () => {
  it("emits a compilable LaTeX skeleton", () => {
    const doc = parseKui(`---\ntitle: Test\nauthor: A\ntemplate: paper-APA\n---\n\n# Intro\nTexto con **negrita** y $x$.\n\n:bibliografia\n`);
    const output = emitLatex(doc, { cwd: process.cwd(), outputDir: "build" });
    expect(output.tex).toContain("\\documentclass");
    expect(output.tex).toContain("\\section{Intro}");
    expect(output.tex).toContain("\\textbf{negrita}");
  });
});
