import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Style-rule release guard: the Unicode character U+2014 (em dash) is forbidden
 * in Jonas Fitness application-owned source. This test scans every repository-
 * owned source area by codepoint and fails the build if any occurrence exists,
 * listing every offending file and line.
 *
 * Covered roots (application-owned):
 *   - app/**
 *   - public/**
 *   - db/**
 *   - scripts/**
 *   - test/**
 *   - docs/**
 *   - README.md
 *   - .env.example
 *
 * Excluded (generated/external content):
 *   - node_modules/**
 *   - .next/**
 *   - .vercel/**
 *   - .sites-runtime/**
 *   - package-lock.json and other dependency lockfiles
 *   - generated caches/artifacts
 *
 * The glyph itself is deliberately never written literally in this file; the
 * forbidden character is referenced only via its Unicode escape sequence.
 */
const ROOT = process.cwd();

const FORBIDDEN = "\u2014";

const SCAN_ROOTS = ["app", "public", "db", "scripts", "test", "docs"];

/** Top-level files (not under a scan root) that are application-owned. */
const SCAN_FILES = ["README.md", ".env.example"];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".html",
  ".txt",
  ".svg",
  ".webmanifest",
  ".md",
]);

const SKIP_DIRS = new Set(["node_modules", ".next", ".vercel", ".sites-runtime", ".git"]);

/** Dependency lockfiles and generated caches are external content, not owned source. */
const SKIP_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

interface Violation {
  file: string;
  line: number;
  column: number;
}

function collectFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else {
      if (SKIP_FILES.has(entry.name)) continue;
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (TEXT_EXTENSIONS.has(ext)) out.push(full);
    }
  }
}

function findViolations(file: string): Violation[] {
  const content = readFileSync(file, "utf8");
  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(FORBIDDEN);
    if (column !== -1) {
      violations.push({
        file: file.split(process.platform === "win32" ? "\\" : "/").join("/").replace(ROOT.replace(/\\/g, "/") + "/", ""),
        line: index + 1,
        column: column + 1,
      });
    }
  }
  return violations;
}

test("application-owned source contains no Unicode U+2014 (em dash)", () => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absolute = join(ROOT, root);
    if (!statSync(absolute, { throwIfNoEntry: false })) continue;
    collectFiles(absolute, files);
  }
  for (const file of SCAN_FILES) {
    const absolute = join(ROOT, file);
    if (statSync(absolute, { throwIfNoEntry: false })) files.push(absolute);
  }
  files.sort();

  const violations: Violation[] = [];
  for (const file of files) {
    violations.push(...findViolations(file));
  }

  assert.equal(
    violations.length,
    0,
    violations.length === 0
      ? "no forbidden U+2014 occurrences"
      : "Forbidden Unicode U+2014 found:\n" + violations.map((v) => `${v.file}:${v.line}:${v.column}`).join("\n"),
  );
});