// AUTHORED-BY Claude Sonnet 5
/**
 * The AUTH SEAM + the pod-scope (SSRF) guard.
 *
 * The server holds NO bespoke crypto. The caller supplies an already-authenticated
 * Solid-OIDC / DPoP `fetch` (e.g. from a reactive-auth session), and every pod
 * operation routes through it. This keeps token handling — the security-critical
 * part — in vetted upstream libraries, not in this package.
 *
 * The pod-scope guard ({@link requirePodScopedUrl}) is the SSRF / capability
 * boundary: it refuses any URL that is not within the configured `podRoot`, so an
 * MCP client / agent cannot use a tool to reach an arbitrary origin (SSRF) or
 * escape the pod root via path traversal.
 *
 * The actual scope check + pod-scoped redirect-following is delegated to
 * `@jeswr/guarded-fetch`'s consolidated `podScope` guard
 * (`assertWithinPodScope` / `podScopedUrl` / `createPodScopedFetch`) — the
 * suite's ONE reviewed home for "is this URL within the configured
 * container?", a strict superset of what this module used to hand-roll (it
 * additionally refuses embedded credentials, scheme-relative targets, and
 * encoded path delimiters). `normalizePodRoot` below stays LOCAL and
 * unchanged: unlike `@jeswr/guarded-fetch`'s more lenient
 * `normalizePodBase` (which silently APPENDS a missing trailing slash),
 * this server deliberately FAILS LOUD at startup config time when `podRoot`
 * is missing its trailing slash (`podRoot must end in '/'`) — `podRoot` is
 * operator-supplied server config, not a per-request value, so a silent
 * auto-fix would mask a misconfiguration. Every error thrown by the
 * guarded-fetch primitives is re-wrapped with the `pod-scope violation:`
 * prefix this package's public contract (and its tests) rely on.
 */
import {
  assertWithinPodScope,
  createPodScopedFetch,
  PodScopeError,
  podScopedUrl,
} from "@jeswr/guarded-fetch";

/**
 * Configuration for a Solid-MCP server instance.
 *
 * The single non-negotiable input is an authenticated `fetch` and the `podRoot`
 * it is scoped to. Everything else is optional, with safe defaults.
 */
export interface SolidMcpConfig {
  /**
   * An authenticated (Solid-OIDC / DPoP) `fetch`, supplied by the caller. The
   * server performs NO token acquisition itself — it just uses this. For public
   * resources you may pass `globalThis.fetch`; for protected resources you MUST
   * pass an authenticated one (otherwise reads fail-closed with a 401/403).
   */
  fetch: typeof fetch;
  /**
   * The absolute http(s) pod (or sub-container) root this server is scoped to.
   * MUST be an absolute http/https URL ending in `/`. Every Resource and Tool is
   * confined to this subtree (the SSRF / capability boundary).
   */
  podRoot: string;
  /**
   * The owner's WebID, if known. Enables best-effort Type-Index discovery in
   * `search`. Optional.
   */
  webId?: string;
  /**
   * Whether the server is read-only. Defaults to `true` (writes disabled). Set to
   * `false` to enable the `solid_write` tool / `writeResource`.
   */
  readOnly?: boolean;
}

/**
 * Validate a {@link SolidMcpConfig.podRoot}: it must be an absolute http(s) URL
 * with a trailing slash. Throws a clear error otherwise. Returns the normalized
 * (parsed-and-restringified) podRoot so callers compare against a canonical form.
 */
export function normalizePodRoot(podRoot: string): string {
  if (typeof podRoot !== "string" || podRoot.length === 0) {
    throw new Error("podRoot is required (an absolute http(s) URL ending in '/').");
  }
  let parsed: URL;
  try {
    parsed = new URL(podRoot);
  } catch {
    throw new Error(
      `podRoot must be an absolute http(s) URL ending in '/', got: ${JSON.stringify(podRoot)}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`podRoot must use http(s), got protocol: ${parsed.protocol}`);
  }
  if (!parsed.pathname.endsWith("/")) {
    throw new Error(`podRoot must end in '/' (a container URL), got: ${podRoot}`);
  }
  // `new URL()` normalizes the origin (lowercases host, applies default ports,
  // resolves `.`/`..` segments in the path), so the returned string is canonical.
  return parsed.toString();
}

/**
 * Resolve `url` against the config's pod root and assert it is WITHIN the pod
 * root. Returns the canonical absolute URL string. THROWS if the resolved URL is
 * outside the pod (different origin, or a path that escapes the root) — this is
 * the SSRF / scope guard.
 *
 * Delegates to `@jeswr/guarded-fetch`'s `assertWithinPodScope` (segment-boundary
 * same-origin path-prefix check on the WHATWG-normalised, canonical URL — `..`
 * traversal and `%2e%2e` style escapes are resolved away before the comparison,
 * so they cannot smuggle the target outside the root), re-wrapping its error
 * with the `pod-scope violation:` prefix this package's public contract relies
 * on. The pod root itself is accepted by default (`allowRoot` defaults to
 * `true`), matching this server's prior behaviour.
 */
export function requirePodScopedUrl(config: { podRoot: string }, url: string): string {
  return scopeOrThrow(config.podRoot, url, { allowRoot: true });
}

/**
 * WRITE-TARGET variant of {@link requirePodScopedUrl}: identical, except the
 * configured pod root itself is NOT an acceptable target (`allowRoot: false`).
 *
 * WHY a distinct guard for writes: `assertWithinPodScope` treats BOTH the
 * slash-terminated root (`…/pod/`) AND its slashless alias (`…/pod`) as "the
 * root", and — under the read default `allowRoot: true` — accepts both. But the
 * slashless alias `…/pod` is a resource in the PARENT container, one level ABOVE
 * the configured `…/pod/` sub-tree; accepting it as a WRITE target lets a client
 * PUT outside the configured scope (a boundary-widening the prior hand-rolled
 * `canonical.startsWith(root)` guard — with `root` slash-terminated — rejected,
 * since `…/pod` does not start with `…/pod/`). Reads may legitimately address the
 * container root (list/read it), so they keep `allowRoot: true`; writes must land
 * strictly UNDER the root, so this guard sets `allowRoot: false`. Fail-closed.
 */
export function requirePodScopedWriteUrl(config: { podRoot: string }, url: string): string {
  return scopeOrThrow(config.podRoot, url, { allowRoot: false });
}

/**
 * Shared core for the two scope guards: resolve+validate `url` against the
 * normalised pod root, re-wrapping any {@link PodScopeError} with the
 * `pod-scope violation:` prefix this package's public contract (and tests) rely
 * on. `allowRoot` distinguishes read (root allowed) from write (root refused).
 */
function scopeOrThrow(podRoot: string, url: string, options: { allowRoot: boolean }): string {
  const root = normalizePodRoot(podRoot);
  try {
    return assertWithinPodScope(root, url, options);
  } catch (err) {
    throw new Error(
      `pod-scope violation: ${err instanceof PodScopeError ? err.message : String(err)}`,
    );
  }
}

/**
 * Non-throwing variant of {@link requirePodScopedUrl}: returns the canonical
 * in-pod URL string, or `undefined` if `url` is not within the pod root (or is
 * not a valid http(s) URL). Use this to FILTER OUT untrusted URLs (e.g. child
 * entries from a container listing, or type-index targets discovered from a
 * profile) rather than throwing — a malicious listing/profile that points at an
 * external origin is silently dropped (fail-closed) instead of aborting the call.
 */
export function podScopedUrlOrUndefined(
  config: { podRoot: string },
  url: string,
): string | undefined {
  const root = normalizePodRoot(config.podRoot);
  return podScopedUrl(root, url);
}

/**
 * Max redirect hops a pod-scoped fetch will follow before giving up. Preserved
 * from this module's prior hand-rolled loop (guarded-fetch's own default is a
 * more conservative 5) so behaviour is unchanged.
 */
const MAX_REDIRECT_HOPS = 10;

/**
 * Wrap an authenticated `fetch` into a POD-SCOPED fetch that handles redirects
 * MANUALLY and validates every hop against the pod scope, via
 * `@jeswr/guarded-fetch`'s `createPodScopedFetch`.
 *
 * WHY: validating only the initial URL is not enough — `fetch` follows 3xx
 * redirects by default, so a poisoned in-pod resource could `302` to an external
 * (or internal-network) target and the underlying fetch would happily follow it,
 * re-opening the SSRF hole that the URL filter closed. `createPodScopedFetch`
 * forces `redirect: "manual"` and re-checks every hop's `Location` against the
 * pod scope before following (fail-closed: a redirect that leaves the pod throws
 * a `PodScopeError`, re-wrapped here as a `pod-scope violation` mentioning the
 * redirect, matching this package's prior error contract). Also applies the
 * WHATWG Fetch-spec-correct method/body-rewrite rules on a method-changing or
 * cross-origin hop (a strict improvement over the prior blanket "always
 * downgrade to GET after hop 1").
 *
 * Use this for every fetch that touches pod data; the one deliberate exception
 * is the off-pod WebID profile fetch (the configured identity), which uses the
 * raw fetch.
 */
export function scopedFetch(config: { podRoot: string; fetch: typeof fetch }): typeof fetch {
  const root = normalizePodRoot(config.podRoot);
  const scoped = createPodScopedFetch(root, {
    fetch: config.fetch,
    maxRedirects: MAX_REDIRECT_HOPS,
  });
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      return await scoped(input, init);
    } catch (err) {
      if (err instanceof PodScopeError) {
        throw new Error(
          `pod-scope violation: redirected outside the configured pod root ${root} ` +
            `(redirect-based SSRF guard) — ${err.message}`,
        );
      }
      throw err;
    }
  };
  return wrapped as typeof fetch;
}

/** True when writes are enabled (the caller explicitly opted out of read-only). */
export function writesEnabled(config: SolidMcpConfig): boolean {
  return config.readOnly === false;
}
