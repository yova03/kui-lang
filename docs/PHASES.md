# Implementation Phases

## v0.x Native PDF MVP

- Fase 0: language design and examples.
- Fase 1: Markdown-extended grammar.
- Fase 1.5: LaTeX ↔ KUI parity table.
- Fase 2: tokenizer/source loading.
- Fase 3: parser to semantic AST.
- Fase 3.5: assets and image validation.
- Fase 4: AST to native PDF renderer.
- Fase 4.5: TOC, bibliography, index/glossary hooks, multi-file includes.
- Fase 4.7: visual styles and aliases.
- Fase 5: academic paper template.
- Fase 5.5: Peruvian thesis template seed.
- Fase 6: CLI.
- Fase 6.5: friendly errors, `kui check`, `kui doctor` boundary.
- Fase 7: additional templates.
- Fase 7.5: i18n.
- Fase 8: VS Code/LSP boundary.
- Fase 8.5: import/export boundary.
- Fase 9: public MVP docs.
- Fase 10: community/template ecosystem.

## v1.0 Native Engine

- M0: keep LaTeX bridge while native stack is built.
- M1: Rust layout engine with text, headings, lists and PDF output.
- M2: native math layout.
- M3: structure, floats, cross-refs and TOC.
- M4: native BibTeX and CSL.
- M5: index, glossary, theorems and footnotes.
- M6: native template DSL and Peruvian templates.
- M7: ES/EN/QU hyphenation and i18n.
- M8: HTML, EPUB and DOCX native backends.

## Current Definition of Done

This repository currently targets the v0.x MVP: `.kui -> AST -> diagnostics -> native PDF`.
LaTeX exists only as an optional export path and must not be treated as the production backend.

## Public MVP Consolidation

- Keep `paper-APA` as the default template across parser, validators, docs and examples.
- Keep all files in `examples/` compiling to PDF without diagnostics.
- Treat `kui check` as the preflight command for authors, with scoped checks for refs, bibliography, assets, tables and accessibility.
- Keep diagnostics friendly with grouped output, close-match suggestions for templates/cross-references/citation keys, and scaffold rejection of unknown template ids.
- Add `kui assets check` for figure route auditing, local/remote asset cache preparation, offline reuse of cached remotes, renderer reuse of cached remotes, raster dimensions/DPI inspection and unsupported-format warnings.
- Make `kui watch` observe includes, declared bibliography files and existing local assets, not only the main `.kui`; keep this covered by a persistent modular-project test.
- Treat `kui doctor` as a native-PDF environment report; LaTeX tools are optional and only relevant to interoperability.
- Defer VS Code/LSP, GitHub Linguist, advanced importers, HTML/EPUB/DOCX and the Rust engine to post-MVP phases.

## v0.1 Local MVP Closure

Closed locally on 2026-05-04:

- Native PDF authoring path: `.kui -> AST -> diagnostics -> PDFKit PDF`.
- Asset workflow for PNG/JPG/JPEG/WEBP, remote cache and offline reuse.
- CLI preflight, watch, doctor and scaffold guardrails.
- Minimum public docs in `README.md`, `docs/QUICKSTART.md` and `docs/MVP-CLOSURE.md`.

Explicitly deferred:

- Automatic SVG/PDF figure conversion.
- Official validation of Peruvian thesis templates beyond the UNSAAC seed.
- Public website/release publication.
- VS Code/LSP, advanced importers and non-PDF backends.
- Rust engine roadmap M1-M8.
