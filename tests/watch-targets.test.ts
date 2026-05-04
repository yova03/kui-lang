import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectWatchTargetFiles } from "../src/cli/watch-targets.js";
import { parseKui } from "../src/parser/kui-parser.js";
import { loadSourceWithIncludes } from "../src/utils/source-loader.js";

describe("collectWatchTargetFiles", () => {
  it("includes main files, includes, references and include-local assets", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kui-watch-targets-"));
    mkdirSync(path.join(cwd, "contenido", "figuras"), { recursive: true });
    writeFileSync(path.join(cwd, "referencias.kref"), "garcia2020:\n  title: Referencia\n", "utf8");
    writeFileSync(path.join(cwd, "contenido", "figuras", "mapa.png"), "image", "utf8");
    writeFileSync(path.join(cwd, "main.kui"), [
      "---",
      "title: Watch",
      "author: A",
      "template: paper-APA",
      "refs: ./referencias.kref",
      "---",
      "",
      ":incluir contenido/capitulo.kui"
    ].join("\n"), "utf8");
    writeFileSync(path.join(cwd, "contenido", "capitulo.kui"), "![Mapa](mapa)\n", "utf8");

    const source = loadSourceWithIncludes(path.join(cwd, "main.kui"));
    const document = parseKui(source.content, { file: source.file });
    document.sourceFiles = source.files;

    const targets = collectWatchTargetFiles(document, cwd).map((file) => path.relative(cwd, file).replace(/\\/g, "/"));

    expect(targets).toEqual([
      "main.kui",
      "contenido/capitulo.kui",
      "referencias.kref",
      "contenido/figuras/mapa.png"
    ]);
  });
});
