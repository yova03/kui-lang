import { cpSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const src = join(process.cwd(), "src/pdf/fonts");
const dest = join(process.cwd(), "dist/src/pdf/fonts");

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log("Fonts copied to dist/src/pdf/fonts/");
}
