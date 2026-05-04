import { rmSync } from "node:fs";
import path from "node:path";

const targets = process.argv.slice(2);
const cleanTargets = targets.length > 0 ? targets : ["dist", "build"];
const cwd = process.cwd();

for (const target of cleanTargets) {
  const resolved = path.resolve(cwd, target);
  const relative = path.relative(cwd, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside project root: ${target}`);
  }
  rmSync(resolved, { force: true, recursive: true });
  console.log(`Cleaned ${relative}`);
}
