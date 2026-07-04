// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * build-dist — produce the committed, self-contained `dist/` for GitHub-branch
 * installs under `ignore-scripts=true`.
 *
 * WHY a bundler (esbuild) instead of plain `tsc`:
 *
 * `@jeswr/solid-mcp` depends on the off-npm `@jeswr/fetch-rdf` package, which a
 * consumer running `npm install github:jeswr/solid-mcp#main` under the suite's
 * `ignore-scripts=true` invariant cannot resolve/build (fetch-rdf ships no usable
 * `dist/`). So the consumer's import would fail. The fix is to make the committed
 * artifact self-contained re: that off-npm dep by INLINING its compiled code into
 * our emitted `dist/*.js`.
 *
 * Externalisation contract (the load-bearing part):
 *   - INLINED  (bundled into dist): the off-npm `@jeswr/fetch-rdf` — by virtue of
 *       being ABSENT from the EXTERNAL list below.
 *   - EXTERNAL (resolved by the consumer): everything else —
 *       `@modelcontextprotocol/sdk`, `zod`, `n3`, `@solid/object`,
 *       `@rdfjs/wrapper`, `@rdfjs/types`, AND fetch-rdf's OWN npm runtime deps
 *       `jsonld-streaming-parser` + `content-type` (all npm-published; we add the
 *       latter two to our `dependencies` so the consumer resolves them).
 *
 * TWO entry points:
 *   - `src/index.ts`  -> `dist/index.js`  (the library public API)
 *   - `src/cli.ts`    -> `dist/cli.js`    (the `solid-mcp` bin; gets a `#!/usr/bin/env node`
 *                                          shebang banner + is made executable)
 *
 * `tsc` still emits the `.d.ts` declarations (declaration-only — esbuild owns the
 * JS). The committed `dist/` is kept in sync with `src/` by
 * `scripts/check-dist-fresh.mjs`.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/**
 * Everything that must stay EXTERNAL (resolved by the consumer, not inlined). The
 * ONLY package bundled in is `@jeswr/fetch-rdf` — by virtue of being absent from
 * this list. fetch-rdf's own runtime deps stay external (npm-published).
 */
const EXTERNAL = [
  "@modelcontextprotocol/sdk",
  "zod",
  "n3",
  "@solid/object",
  "@rdfjs/wrapper",
  "@rdfjs/types",
  // @jeswr/fetch-rdf's own runtime deps — npm-published, kept external:
  "jsonld-streaming-parser",
  "content-type",
  // @jeswr/guarded-fetch ships a proper committed dist/ (unlike fetch-rdf), so
  // it is a normal `dependencies` entry a consumer's package manager resolves —
  // no build-deps inlining needed.
  "@jeswr/guarded-fetch",
];

async function main(buildDir = outdir) {
  // 1. Ensure @jeswr/fetch-rdf's dist exists in node_modules so esbuild can
  //    resolve + inline it (ignore-scripts skipped its prepare on install).
  execFileSync("node", [join(root, "scripts", "build-deps.mjs")], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  // 2. Clean target then bundle the runtime JS for BOTH entry points. esbuild
  //    owns dist/index.js + dist/cli.js; only the cli gets the Node shebang.
  rmSync(buildDir, { recursive: true, force: true });
  await build({
    entryPoints: [join(root, "src", "index.ts"), join(root, "src", "cli.ts")],
    outdir: buildDir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Inline ONLY @jeswr/fetch-rdf; keep the npm-published deps external.
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
    // Shebang on the bin entry. (esbuild's `banner.js` is applied to every output
    // file in a multi-entry build; the cli is the only entry that should carry it,
    // but the index.js library entry is never executed as a script, so a leading
    // shebang comment there is inert. We instead scope it via a per-entry build to
    // keep index.js clean — see below.)
  });

  // esbuild's `banner` is per-build (not per-entry), so re-bundle ONLY the cli
  // entry with the shebang to avoid leaking it into index.js. This second pass
  // overwrites dist/cli.js with the shebang-prefixed version.
  await build({
    entryPoints: [join(root, "src", "cli.ts")],
    outfile: join(buildDir, "cli.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
    banner: { js: "#!/usr/bin/env node" },
  });

  // Make the bin executable so `npx solid-mcp` / a PATH symlink works.
  const cliPath = join(buildDir, "cli.js");
  if (existsSync(cliPath)) {
    chmodSync(cliPath, 0o755);
  }

  // 3. Emit the .d.ts declarations (declaration-only — esbuild already wrote JS).
  execFileSync(
    "node",
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(root, "tsconfig.build.json"),
      "--outDir",
      buildDir,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
