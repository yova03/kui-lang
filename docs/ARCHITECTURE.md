# KUI Architecture

KUI is implemented around a stable semantic core and replaceable renderers. The primary renderer is native PDF and does not require LaTeX.

```text
.kui files
  -> SourceLoader / IncludeResolver
  -> FrontmatterReader
  -> KUI Parser
  -> AST with source positions
  -> Semantic validation
  -> Renderer adapter
       -> NativePdfEngine v0.x
       -> LatexBridge optional export
       -> HTML/EPUB/DOCX future backends
```

## Stable Core

- `src/parser`: parses KUI Markdown extensions and normalizes aliases.
- `src/core/ast.ts`: semantic AST that must not depend on LaTeX.
- `src/semantic`: preflight validation for references, citations, assets, headings, templates.
- `src/templates`: neutral template manifest registry.

## Native PDF Renderer

`src/pdf` renders the AST directly to PDF through a native renderer. This is the default path used by `kui build` and `kui pdf`.

## Optional LaTeX Export

`src/latex` renders the AST to readable `.tex` for interoperability with Overleaf or existing LaTeX workflows. It is not the primary compiler.

## Future Rust Engine Boundary

`src/engine/native-engine.ts` defines the future Rust/native renderer boundary. The future Rust engine should consume the same `DocumentNode` or an IR derived from it.
