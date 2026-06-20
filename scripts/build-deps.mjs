// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Inline dependency build for `@jeswr/fetch-rdf` — the suite's `build:packages`
// pattern. Because the suite pins `ignore-scripts=true` (supply-chain hardening),
// the git dependency's own `prepare` build never runs, and the git pack of
// `@jeswr/fetch-rdf` ships NO `dist/` (its `files` is `["dist","README.md"]` but
// `dist/` is absent at pack time). So we build it ourselves, once, after install:
// clone the source, compile it with the local TypeScript, and drop the built
// `dist/` into `node_modules/@jeswr/fetch-rdf`. esbuild then INLINES that built
// dist into our own committed `dist/` so the published artifact is self-contained.
//
// REPRODUCIBILITY: the clone is pinned to the EXACT git commit resolved in
// `package-lock.json` (not a moving `main`), so the built dep always matches the
// lockfile-resolved version — `npm ci` on CI and a dev `npm install` build the
// same source. Building from `main` would silently drift from the lockfile.
//
// DURABLE FIX: this whole `build:deps` hack exists ONLY because `@jeswr/fetch-rdf`
// does not publish a usable `dist/`. Once fetch-rdf ships a proper packaged `dist`
// (the upstream packaging fix), DELETE this script and the `build:deps` step and
// depend on the published package directly.
//
// Idempotent: if `dist/index.js` is already present (e.g. a prior run) this is a
// no-op. Network is needed only the first time.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEP_DIR = join(ROOT, "node_modules", "@jeswr", "fetch-rdf");
const DEP_DIST = join(DEP_DIR, "dist", "index.js");
const LOCKFILE = join(ROOT, "package-lock.json");
const FETCH_RDF_GIT = "https://github.com/jeswr/fetch-rdf.git";

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

/**
 * Read the EXACT git commit `@jeswr/fetch-rdf` resolves to from
 * `package-lock.json`, so the clone is pinned (reproducible) rather than tracking
 * a moving `main`. The lock's `resolved` is a git URL ending `#<commit-or-ref>`.
 * Returns the ref after `#`, or `undefined` if it cannot be determined (caller
 * then refuses to build from an unpinned source — failing closed beats a silently
 * non-reproducible build).
 */
function resolvedFetchRdfRef() {
  if (!existsSync(LOCKFILE)) {
    return undefined;
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCKFILE, "utf8"));
  } catch {
    return undefined;
  }
  const entry = lock.packages?.["node_modules/@jeswr/fetch-rdf"];
  const resolved = entry?.resolved;
  if (typeof resolved !== "string") {
    return undefined;
  }
  const hash = resolved.lastIndexOf("#");
  if (hash === -1) {
    return undefined;
  }
  const ref = resolved.slice(hash + 1).trim();
  return ref.length > 0 ? ref : undefined;
}

function main() {
  if (existsSync(DEP_DIST)) {
    return; // already built — nothing to do.
  }
  if (!existsSync(DEP_DIR)) {
    console.error("[build-deps] @jeswr/fetch-rdf is not installed. Run `npm install` first.");
    process.exit(1);
  }

  const ref = resolvedFetchRdfRef();
  if (!ref) {
    console.error(
      "[build-deps] could not resolve the @jeswr/fetch-rdf git commit from package-lock.json; " +
        "refusing to build from an unpinned source (a non-reproducible build). " +
        "Run `npm install` to (re)generate the lockfile.",
    );
    process.exit(1);
  }

  console.log(
    `[build-deps] building @jeswr/fetch-rdf dist at pinned commit ${ref} (ignore-scripts skipped its prepare)…`,
  );
  const work = mkdtempSync(join(tmpdir(), "fetch-rdf-build-"));
  try {
    // Clone then check out the EXACT lockfile-resolved commit (deterministic).
    run(`git clone ${FETCH_RDF_GIT} "${work}"`);
    run(`git checkout --quiet ${ref}`, work);
    // Build with this repo's TypeScript so no extra toolchain is needed.
    run("npm install --no-audit --no-fund --ignore-scripts --prefer-offline", work);
    run(`node "${join(ROOT, "node_modules", "typescript", "bin", "tsc")}" -p tsconfig.json`, work);

    // Copy the built dist (and src, for source maps) into the installed package.
    cpSync(join(work, "dist"), join(DEP_DIR, "dist"), { recursive: true });
    if (existsSync(join(work, "src"))) {
      cpSync(join(work, "src"), join(DEP_DIR, "src"), { recursive: true });
    }
    // Ensure the package.json `files` allowance does not hide the dist we just
    // copied from Node's resolver (it resolves by `main`, so this is belt-and-braces).
    const pkgPath = join(DEP_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.main = pkg.main ?? "./dist/index.js";
    pkg.types = pkg.types ?? "./dist/index.d.ts";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("[build-deps] @jeswr/fetch-rdf dist built.");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
