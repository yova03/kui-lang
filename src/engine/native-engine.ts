import type { DocumentNode } from "../core/ast.js";
import type { CompileOptions } from "../core/project.js";
import { emitNativePdf } from "../pdf/native-pdf.js";

export interface NativeRenderResult {
  pdfBytes: Uint8Array;
  diagnostics: string[];
}

export interface NativePdfEngine {
  render(document: DocumentNode): Promise<NativeRenderResult>;
}

export class PdfKitNativeEngine implements NativePdfEngine {
  constructor(private readonly options: CompileOptions) {}

  async render(document: DocumentNode): Promise<NativeRenderResult> {
    const output = await emitNativePdf(document, this.options);
    return {
      pdfBytes: output.pdfBytes,
      diagnostics: output.diagnostics.map((diagnostic) => diagnostic.message)
    };
  }
}
