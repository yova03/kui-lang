export interface KuiProjectConfig {
  main?: string;
  template?: string;
  buildDir?: string;
  language?: string;
}

export interface CompileOptions {
  cwd: string;
  outputDir: string;
  target?: "tex" | "pdf";
  strict?: boolean;
  pdfEngine?: "pdflatex" | "xelatex" | "lualatex";
}

export interface BuildArtifact {
  texPath: string;
  pdfPath?: string;
  auxFiles: string[];
}
