import { describe, expect, it } from "vitest";
import { formatReferenceEntry, parseReferenceContent, resolveCitationStyle } from "../src/semantic/bibliography.js";
import { normalizeFrontmatterAliases } from "../src/parser/frontmatter.js";

describe("KUIRef bibliography", () => {
  it("parses YAML-style .kref entries", () => {
    const entries = parseReferenceContent(`garcia2020:
  type: article
  title: Wari en Cusco
  author:
    - Ana García
  year: 2020
  journal: Revista Andina
`, "kref");

    expect(entries).toEqual([
      {
        key: "garcia2020",
        type: "article",
        title: "Wari en Cusco",
        author: ["Ana García"],
        year: "2020",
        journal: "Revista Andina",
        publisher: undefined,
        booktitle: undefined,
        school: undefined,
        institution: undefined,
        howpublished: undefined,
        note: undefined,
        doi: undefined,
        url: undefined
      }
    ]);
    expect(formatReferenceEntry(entries[0])).toBe("Ana García (2020). Wari en Cusco. Revista Andina.");
  });

  it("parses BibTeX entries with nested braces", () => {
    const entries = parseReferenceContent(`@misc{UNSAAC2011,
  author = {{Universidad Nacional de San Antonio Abad del Cusco}},
  title = {Catastro arqueológico de asentamientos prehispánicos en el distrito de {Tapayrihua}},
  year = {2011}
}
`, "bib");

    expect(entries[0]).toMatchObject({
      key: "UNSAAC2011",
      author: ["Universidad Nacional de San Antonio Abad del Cusco"],
      title: "Catastro arqueológico de asentamientos prehispánicos en el distrito de Tapayrihua",
      year: "2011"
    });
    expect(formatReferenceEntry(entries[0])).toBe("Universidad Nacional de San Antonio Abad del Cusco (2011). Catastro arqueológico de asentamientos prehispánicos en el distrito de Tapayrihua.");
  });

  it("formats article entries in IEEE style", () => {
    const entries = parseReferenceContent(`garcia2020:
  type: article
  title: Wari en Cusco
  author:
    - Ana García
  year: 2020
  journal: Revista Andina
`, "kref");

    expect(formatReferenceEntry(entries[0], "ieee")).toBe('A. García, "Wari en Cusco," Revista Andina, 2020.');
  });

  it("keeps institutional authors verbatim in IEEE style", () => {
    const entries = parseReferenceContent(`@misc{UNSAAC2011,
  author = {{Universidad Nacional de San Antonio Abad del Cusco}},
  title = {Catastro arqueológico},
  year = {2011}
}
`, "bib");

    expect(formatReferenceEntry(entries[0], "ieee")).toBe('Universidad Nacional de San Antonio Abad del Cusco, "Catastro arqueológico," 2011.');
  });

  it("joins multiple IEEE authors and inverts comma-form names", () => {
    const entries = parseReferenceContent(`quispe2021:
  type: article
  title: Andenes
  author:
    - Quispe, Rosa
    - Juan Pérez
  year: 2021
  journal: Allpa
`, "kref");

    expect(formatReferenceEntry(entries[0], "ieee")).toBe('R. Quispe and J. Pérez, "Andenes," Allpa, 2021.');
  });
});

describe("resolveCitationStyle", () => {
  it("detects ieee from csl values", () => {
    expect(resolveCitationStyle({ csl: "ieee" })).toBe("ieee");
    expect(resolveCitationStyle({ csl: "IEEE.csl" })).toBe("ieee");
  });

  it("treats other csl values as apa", () => {
    expect(resolveCitationStyle({ csl: "apa.csl" })).toBe("apa");
    expect(resolveCitationStyle({ csl: "chicago" })).toBe("apa");
  });

  it("falls back to the template default", () => {
    expect(resolveCitationStyle(undefined, "ieee")).toBe("ieee");
    expect(resolveCitationStyle({}, undefined)).toBe("apa");
  });

  it("accepts the Spanish frontmatter alias citas:", () => {
    const data = normalizeFrontmatterAliases({ citas: "ieee" });
    expect(resolveCitationStyle(data)).toBe("ieee");
  });
});
