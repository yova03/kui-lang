const replacements: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "%": "\\%",
  "&": "\\&",
  "#": "\\#",
  "$": "\\$",
  "_": "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}"
};

export function escapeLatex(value: string): string {
  return value.replace(/[\\%&#$_{}~^]/g, (char) => replacements[char] ?? char);
}

export function latexColor(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return `[HTML]{${value.slice(1).toUpperCase()}}`;
  return `{${escapeLatex(value)}}`;
}
