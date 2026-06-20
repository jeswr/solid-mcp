// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * check-dist-fresh — guard against the COMMITTED `dist/` drifting from `src/`.
 *
 * `dist/` is committed (not gitignored) so the package installs directly from a
 * GitHub branch without a build step — consumers run under `ignore-scripts=true`
 * and never execute this package's `prepare`/`build`. That only stays correct if
 * the committed artifact matches the source. This script rebuilds into a scratch
 * dir (the SAME bundled build as `npm run build` — esbuild bundles `index.js` +
 * `cli.js` with `@jeswr/fetch-rdf` inlined; tsc emits the `.d.ts`) and diffs the
 * emitted JavaScript + declarations against the version of `dist/` at git HEAD.
 *
 * Why compare against git HEAD, not the working-tree `dist/`:
 *  - `npm run build` overwrites the working-tree `dist/`. If this check read the
 *    working tree, then running it AFTER `build` would compare a fresh build
 *    against a just-overwritten fresh build — always equal, so a STALE *committed*
 *    `dist/` would never be caught. Comparing against the blobs at
 *    `HEAD:dist/<path>` makes the check independent of whether `build` ran first
 *    and of the working tree's state.
 *
 * It deliberately ignores the `*.map` sourcemap files: their byte content can
 * vary with absolute paths / tooling versions, and they are not load-bearing for
 * a consumer importing the package. Code (`.js`) and types (`.d.ts`) matter.
 *
 * Exit 0 = in sync; exit 1 = drift (run `npm run build` and commit `dist/`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Recursively list relative paths of emitted `.js`/`.d.ts` files under `dir`,
 * skipping `*.map` sourcemaps (vary with absolute paths, not load-bearing).
 */
function listArtifacts(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (/\.(js|d\.ts)$/.test(entry.name) && !entry.name.endsWith(".map")) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

function toKey(base, abs) {
  return relative(base, abs).split(sep).join("/");
}

/** Read a committed `dist/<key>` blob from git HEAD, or `null` if absent. */
function readCommittedDist(key) {
  try {
    return execFileSync("git", ["show", `HEAD:dist/${key}`], {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

/**
 * The set of `.js`/`.d.ts` artifacts committed under `dist/` at git HEAD,
 * keyed by their path RELATIVE to `dist/`. Uses `git ls-tree` so it reads the
 * COMMITTED tree, never the working copy.
 */
function committedDistKeysAtHead() {
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "dist"], {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((p) => /\.(js|d\.ts)$/.test(p) && !p.endsWith(".map"))
    .map((p) => p.replace(/^dist\//, ""));
}

let scratch;
try {
  scratch = mkdtempSync(join(tmpdir(), "solid-mcp-dist-"));
  const freshDist = join(scratch, "dist");
  // Rebuild into a scratch outDir using the SAME bundled build pipeline.
  execFileSync("node", [join(root, "scripts", "build-dist.mjs"), freshDist], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const freshFiles = new Map(listArtifacts(freshDist).map((p) => [toKey(freshDist, p), p]));
  const committedKeys = new Set(committedDistKeysAtHead());

  const drift = [];
  for (const [key, freshPath] of freshFiles) {
    const committed = readCommittedDist(key);
    if (committed === null) {
      drift.push(`missing in committed dist/: ${key}`);
      continue;
    }
    if (readFileSync(freshPath, "utf8") !== committed) {
      drift.push(`out of date: ${key}`);
    }
  }
  for (const key of committedKeys) {
    if (!freshFiles.has(key)) {
      drift.push(`stale (no longer emitted): dist/${key}`);
    }
  }

  if (drift.length > 0) {
    console.error("committed dist/ is out of sync with src/:");
    for (const d of drift) {
      console.error(`  - ${d}`);
    }
    console.error("\nRun `npm run build` and commit dist/.");
    process.exit(1);
  }
  console.log(`committed dist/ matches src/ (${freshFiles.size} artifacts).`);
} finally {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
  }
}
