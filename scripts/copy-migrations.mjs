import { mkdirSync, readdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src", "core", "schema", "migrations");
const destDir = join(__dirname, "..", "dist", "core", "schema", "migrations");

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith(".sql"));
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}

console.log(`Copied ${files.length} migration file(s) to dist/core/schema/migrations/`);
