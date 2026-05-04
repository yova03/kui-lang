import { describe, expect, it } from "vitest";
import { formatReferenceEntry, parseReferenceContent } from "../src/semantic/bibliography.js";

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
});
