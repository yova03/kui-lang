# LinkedIn — EN (editorial post, ~205 words)

> Attach `mockup-landscape-1200x630.png`. Replace `https://github.com/yova03/kui-lang` before posting.

---

Academic research shouldn't fight its compiler.

For years, writing a thesis or a formal paper meant learning LaTeX before learning to research: installing multi-gigabyte distributions, decoding errors no human should ever read, and dropping half of one's ideas because the format weighed more than the argument.

That's why I built **KUI**: an academic document language with the calm of a field notebook. One line of text becomes a numbered figure, a captioned table, a native chart. The PDF compiles directly — no LaTeX, no intermediate HTML.

Three design decisions shape the project:

— **Readable syntax.** `imagen kui-logo | KUI logotype` replaces ten lines of markup.
— **Native PDF.** A custom Node renderer, with no heavy external dependencies.
— **Token-compact.** Designed to be written alongside an LLM: less ceremony, lower cost, more archive.

The first thesis shipped in KUI is an archaeology dissertation at Universidad Nacional San Antonio Abad del Cusco (UNSAAC, Peru). Modular chapters, bibliography, table of contents, and automatic figures — all from a single `main.kui`.

KUI is open source. The validator, templates and renderer are available for review and contribution.

OPEN THE ARCHIVE → https://github.com/yova03/kui-lang
