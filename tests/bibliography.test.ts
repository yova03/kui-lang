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
        doi: undefined,
        url: undefined
      }
    ]);
    expect(formatReferenceEntry(entries[0])).toBe("Ana García (2020). Wari en Cusco. Revista Andina.");
  });
});
