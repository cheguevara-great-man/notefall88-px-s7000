import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { parseMusicXmlFile } from "../src/musicxml";

const input = process.argv[2];
if (!input) throw new Error("usage: vite-node scripts/export-musicxml-score.ts <score>");
const path = resolve(input);
const bytes = readFileSync(path);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
process.stdout.write(`${JSON.stringify(parseMusicXmlFile(buffer, basename(path)).score)}\n`);
