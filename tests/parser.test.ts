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
    const doc = parseKui(":indice\n:paginacion romana\n:bibliografia\n");
    expect(doc.children.map((node) => node.kind === "Directive" ? node.name : "")).toEqual(["toc", "pagenumbering", "bibliography"]);
    const pageNumbering = doc.children[1];
    expect(pageNumbering?.kind === "Directive" ? pageNumbering.args : "").toBe("romana");
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

  it("ignores source comments outside code blocks", () => {
    const doc = parseKui([
      "# Intro",
      "// comentario interno",
      "Texto visible.",
      "% nota para el autor",
      "<!--",
      "comentario largo",
      "-->",
      ":indice"
    ].join("\n"));

    expect(doc.children.map((node) => node.kind)).toEqual(["Heading", "Paragraph", "Directive"]);
    const paragraph = doc.children[1];
    expect(paragraph?.kind === "Paragraph" ? paragraph.children.map((node) => node.kind === "Text" ? node.value : "").join("") : "").toBe("Texto visible.");
  });

  it("keeps comment markers inside fenced code blocks", () => {
    const doc = parseKui(["```kui", "// visible en codigo", "% visible en codigo", "<!-- visible en codigo -->", "```"].join("\n"));
    const code = doc.children[0];

    expect(code?.kind).toBe("CodeBlock");
    if (code?.kind !== "CodeBlock") throw new Error("Expected code block");
    expect(code.content).toContain("// visible en codigo");
    expect(code.content).toContain("% visible en codigo");
    expect(code.content).toContain("<!-- visible en codigo -->");
  });

  it("allows comments before tables, figures and directives", () => {
    const doc = parseKui([
      "// antes de tabla",
      "| Campo | Valor |",
      "| :-- | :-- |",
      "| Sitio | Ayallacta |",
      ": Datos visibles {#tbl:datos}",
      "% antes de figura",
      "![Plano visible](plano.png) {#fig:plano}",
      "<!-- antes de directiva -->",
      ":bibliografia"
    ].join("\n"));

    expect(doc.children.map((node) => node.kind)).toEqual(["Table", "Figure", "Directive"]);
    expect(doc.symbols.labels["tbl:datos"]).toBeTruthy();
    expect(doc.symbols.labels["fig:plano"]).toBeTruthy();
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

  it("parses short chart commands as semantic bar charts", () => {
    const doc = parseKui(":grafico Permanencia | Ciclo 1=98.6 | Ciclo 2=96.1\n");
    const block = doc.children[0];

    expect(block?.kind).toBe("FencedDiv");
    if (block?.kind !== "FencedDiv") throw new Error("Expected fenced div");
    expect(block.canonicalName).toBe("bar-chart");
    expect(block.attrs?.normalized.title).toBe("Permanencia");
    expect(block.children[0]?.kind).toBe("List");
  });

  it("normalizes easy frontmatter aliases", () => {
    const doc = parseKui(`---\ntitulo: Documento facil\nautor: Equipo\nplantilla: paper-APA\nreferencias: ./referencias.kref\n---\n`);

    expect(doc.frontmatter?.data.title).toBe("Documento facil");
    expect(doc.frontmatter?.data.author).toBe("Equipo");
    expect(doc.frontmatter?.data.template).toBe("paper-APA");
    expect(doc.frontmatter?.data.refs).toBe("./referencias.kref");
  });

  it("accepts simple frontmatter without YAML fences and keeps template fields", () => {
    const doc = parseKui([
      "titulo: Tesis KUI facil",
      "autor: Equipo",
      "plantilla: tesis-unsaac",
      "asesor: Compilador KUI",
      "coasesor: Equipo asesor",
      "institucion: Proyecto KUI",
      "facultad: Documentos programables",
      "escuela: Arqueología",
      "grado: Licenciado en Arqueología",
      "",
      "# Introduccion"
    ].join("\n"));

    expect(doc.frontmatter?.data.title).toBe("Tesis KUI facil");
    expect(doc.frontmatter?.data.template).toBe("tesis-unsaac");
    expect(doc.frontmatter?.data.asesor).toBe("Compilador KUI");
    expect(doc.frontmatter?.data.coasesor).toBe("Equipo asesor");
    expect(doc.frontmatter?.data.school).toBe("Arqueología");
    expect(doc.frontmatter?.data.academicDegree).toBe("Licenciado en Arqueología");
    expect(doc.children[0]?.kind).toBe("Heading");
  });

  it("adds friendly defaults from the first heading", () => {
    const doc = parseKui("# Titulo inferido\n\nTexto normal.");

    expect(doc.frontmatter?.data.template).toBe("paper-APA");
    expect(doc.frontmatter?.data.title).toBe("Titulo inferido");
    expect(doc.frontmatter?.data.author).toBe("Autor no declarado");
  });

  it("adds automatic labels to headings and simple tables", () => {
    const doc = parseKui("# Resultados\n\n# Resultados\n\n:tabla Datos finales | Campo; Valor | Casos; 120\n");
    const headings = doc.children.filter((node) => node.kind === "Heading");
    const table = doc.children.find((node) => node.kind === "Table");

    expect(headings[0]?.attrs?.id).toBe("sec:resultados");
    expect(headings[1]?.attrs?.id).toBe("sec:resultados-2");
    expect(table?.attrs?.id).toBe("tbl:datos-finales");
  });

  it("parses easy semantic commands", () => {
    const doc = parseKui([
      ":nota Esta es una nota simple.",
      ":kpis Indicadores | PDF=Directo | Tablas=Medidas",
      ":semaforo Estado | Texto=verde | Graficos=azul",
      ":cronograma Plan | Fuente=Escribir | PDF=Compilar",
      ":firma Firmas | Equipo KUI=Autor | Usuario=Revisor",
      ":cuadrado Texto | azul | fondo=amarillo | grande | sombra"
    ].join("\n\n"));

    expect(doc.children.map((node) => node.kind === "FencedDiv" ? node.canonicalName : "")).toEqual([
      "note",
      "kpi-grid",
      "status-grid",
      "timeline",
      "signature",
      "shape"
    ]);
  });

  it("parses easy commands without colon, multiline tables, formulas and simple directives", () => {
    const doc = parseKui([
      "indice",
      "",
      "imagen kui-logo | Logo de KUI",
      "",
      "grafico Permanencia | Ciclo 1=98.6 | Ciclo 2=96.1",
      "",
      "formula rho = n / V",
      "",
      "tabla Resultados",
      "Campo; Valor; Estado",
      "Casos; 120; Activo",
      "Riesgo; Alto; Revisar",
      "",
      "nota Esta nota no usa dos puntos."
    ].join("\n"));

    expect(doc.children[0]?.kind === "Directive" ? doc.children[0].name : "").toBe("toc");
    expect(doc.children.some((node) => node.kind === "Figure" && node.path === "kui-logo")).toBe(true);
    expect(doc.children.some((node) => node.kind === "FencedDiv" && node.canonicalName === "bar-chart")).toBe(true);
    expect(doc.children.some((node) => node.kind === "MathBlock" && node.content === "rho = n / V")).toBe(true);

    const table = doc.children.find((node) => node.kind === "Table");
    expect(table?.kind).toBe("Table");
    if (table?.kind !== "Table") throw new Error("Expected table");
    expect(table.headers.map((cell) => cell.map((node) => node.kind === "Text" ? node.value : "").join(""))).toEqual(["Campo", "Valor", "Estado"]);
    expect(table.rows).toHaveLength(2);
  });

  it("parses easy coordinate planes from multiline UTM points", () => {
    const doc = parseKui([
      "plano Poligono UTM 18S",
      "zona 18S",
      "datum WGS84",
      "escala 1:1000",
      "cerrar",
      "P1 826320 8502705",
      "P2 826465 8502760",
      "P3 826548 8502892"
    ].join("\n"));
    const block = doc.children[0];

    expect(block?.kind).toBe("FencedDiv");
    if (block?.kind !== "FencedDiv") throw new Error("Expected fenced div");
    expect(block.canonicalName).toBe("coordinate-plane");
    expect(block.attrs?.normalized.title).toBe("Poligono UTM 18S");
    expect(block.attrs?.normalized.zone).toBe("18S");
    expect(block.attrs?.normalized.scale).toBe("1:1000");
    expect(block.attrs?.normalized.closed).toBe("true");
    expect(block.children[0]?.kind).toBe("List");
  });
});
