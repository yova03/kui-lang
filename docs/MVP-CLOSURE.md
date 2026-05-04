# MVP Closure Notes

Date: 2026-05-04

## Closed For v0.1 Local MVP

The local v0.1 target is closed when the repository can take `.kui` sources through:

```text
.kui -> source loading/includes -> AST -> diagnostics -> native PDF
```

The production path is native PDF through PDFKit. LaTeX export remains available only for interoperability.

## Closed Phases In This Repository

- Fase 3.5: asset audit and cache workflow.
- Fase 6: CLI with `new`, `check`, `assets check`, `pdf`, `build`, `watch`, `clean`, `doctor`, `templates` and limited `import`/`export`.
- Fase 6.5: grouped diagnostics, scoped preflight checks, `doctor`, close-match suggestions and scaffold guardrails.
- Fase 9: minimum public documentation for source users through `README.md`, `docs/QUICKSTART.md` and this closure note.

## Asset Decision

For v0.1, KUI renders PNG, JPG, JPEG and WEBP in the native PDF path.

SVG and PDF figures are intentionally not converted automatically in v0.1. They are resolved and reported as unsupported with a clear diagnostic. Authors should convert them to PNG/JPG/WEBP before compiling. Automatic SVG/PDF conversion is deferred because it requires an external conversion stack decision, such as Inkscape, Ghostscript, resvg or a bundled converter.

Remote images are supported through `kui assets check`, which downloads and records them in `build/cache/assets/manifest.json`. If the network later fails, the existing cache is reused.

## Verification Commands

Run these before a v0.1 tag:

```bash
npm run build
npm test
npm run dev -- doctor
npm run dev -- check examples/paper.kui
npm run dev -- assets check examples/paper.kui
npm run dev -- pdf examples/paper.kui
```

Compile every example:

```powershell
Get-ChildItem .\examples -Filter *.kui | ForEach-Object { node .\dist\src\cli\index.js pdf $_.FullName }
```

Expected result: every example compiles without diagnostics and writes a PDF in `build/`.

## Remaining Work After v0.1

- Validate `tesis-unsaac` against a real current faculty regulation and a real thesis.
- Add more official Peruvian thesis templates.
- Complete LaTeX/KUI parity cases for multicolumn tables, subfigures and longtable-like flows.
- Publish website/release artifacts outside the local repository.
- Build VS Code/LSP tooling.
- Add advanced importers for `.tex`, `.docx` and `.ipynb`.
- Start the Rust engine roadmap M1-M8.
