import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const fromDir = path.join(rootDir, "frontend", "public");
const toDir = path.join(rootDir, "dist", "frontend", "public");

fs.mkdirSync(toDir, { recursive: true });
fs.cpSync(fromDir, toDir, { recursive: true });
