#!/usr/bin/env node
/**
 * Lightweight repository checks: syntax-check JS files and validate JSON.
 * No npm dependencies; safe to run on any OS.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", "dist", ".git", ".npm-cache", "data"]);
const checked = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (entry.isDirectory() && SKIP.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
    } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
      checked.push(file);
    }
  }
}

walk(ROOT);

let failed = 0;
for (const file of checked) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nSyntax check failed: ${relative(ROOT, file)}`);
    failed++;
  }
}

for (const json of ["package.json", "package-lock.json"]) {
  try {
    JSON.parse(readFileSync(join(ROOT, json), "utf8"));
  } catch (error) {
    console.error(`Invalid JSON: ${json}: ${error.message}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`OK — ${checked.length} JavaScript files and package metadata are valid.`);
