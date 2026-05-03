import { describe, expect, it } from "vitest";
import { parseKui } from "../src/parser/kui-parser.js";

describe("parseKui", () => {
  it("parses frontmatter, headings, citations and math labels", () => {
    const doc = parseKui(`---\ntitle: Test\ntemplate: paper-APA\n---\n\n# Intro {#sec:intro}\nSegún @garcia2020 ver @eq:x.\n\n$$\nx=1\n$$ {#eq:x}\n`);

    expect(doc.frontmatter?.data.template).toBe("paper-APA");
    expect(doc.children[0]?.kind).toBe("Heading");
    expect(doc.symbols.labels["sec:intro"]).toBeTruthy();
    expect(doc.symbols.labels["eq:x"]).toBeTruthy();
    expect(doc.symbols.citations.garcia2020).toBeTruthy();
  });

  it("normalizes Spanish directives", () => {
    const doc = parseKui(":indice\n:bibliografia\n");
    expect(doc.children.map((node) => node.kind === "Directive" ? node.name : "")).toEqual(["toc", "bibliography"]);
  });

  it("parses table captions, labels, refs and alignments", () => {
    const doc = parseKui("Ver @tbl:datos.\n\n| Sitio | Año | Valor |\n| :--- | ---: | :---: |\n| Pikillaqta | 2026 | Alto |\n: Datos principales {#tbl:datos}\n");
    const table = doc.children.find((node) => node.kind === "Table");

    expect(table?.kind).toBe("Table");
    if (table?.kind !== "Table") throw new Error("Expected table");
    expect(table.caption?.map((node) => node.kind === "Text" ? node.value : "").join("")).toBe("Datos principales");
    expect(table.attrs?.id).toBe("tbl:datos");
    expect(table.alignments).toEqual(["left", "right", "center"]);
    expect(doc.symbols.labels["tbl:datos"]).toBeTruthy();
    expect(doc.symbols.citations["ref:tbl:datos"]).toBeTruthy();
  });

  it("does not consume a fenced-div closing marker as a table caption", () => {
    const doc = parseKui(":::matriz-riesgo\n| Riesgo | Prioridad |\n| :--- | :--- |\n| Vigencia | Critica |\n:::\n");
    const block = doc.children[0];

    expect(block?.kind).toBe("FencedDiv");
    if (block?.kind !== "FencedDiv") throw new Error("Expected fenced div");
    expect(block.canonicalName).toBe("risk-matrix");
    expect(block.children).toHaveLength(1);
    expect(doc.diagnostics).toHaveLength(0);
  });

  it("parses short image commands with automatic figure labels", () => {
    const doc = parseKui("Ver @fig:kui-compiler-pipeline.\n\n:img ./figuras/kui-compiler-pipeline.png | Flujo del compilador KUI\n");
    const figure = doc.children.find((node) => node.kind === "Figure");

    expect(figure?.kind).toBe("Figure");
    if (figure?.kind !== "Figure") throw new Error("Expected figure");
    expect(figure.path).toBe("./figuras/kui-compiler-pipeline.png");
    expect(figure.attrs?.id).toBe("fig:kui-compiler-pipeline");
    expect(figure.caption.map((node) => node.kind === "Text" ? node.value : "").join("")).toBe("Flujo del compilador KUI");
    expect(doc.symbols.labels["fig:kui-compiler-pipeline"]).toBeTruthy();
    expect(doc.symbols.citations["ref:fig:kui-compiler-pipeline"]).toBeTruthy();
  });
});
