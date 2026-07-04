// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import {
  normalizePodRoot,
  requirePodScopedUrl,
  requirePodScopedWriteUrl,
  writesEnabled,
} from "../src/auth.js";

const POD = "https://alice.example/pod/";

describe("normalizePodRoot", () => {
  it("accepts an absolute https URL ending in '/'", () => {
    expect(normalizePodRoot(POD)).toBe(POD);
  });

  it("accepts http", () => {
    expect(normalizePodRoot("http://localhost:3000/")).toBe("http://localhost:3000/");
  });

  it("canonicalises the URL (host case, default port, dot segments)", () => {
    expect(normalizePodRoot("https://Alice.Example/pod/")).toBe("https://alice.example/pod/");
    expect(normalizePodRoot("https://alice.example:443/pod/")).toBe("https://alice.example/pod/");
    expect(normalizePodRoot("https://alice.example/pod/sub/../")).toBe(
      "https://alice.example/pod/",
    );
  });

  it("rejects an empty / non-string podRoot", () => {
    expect(() => normalizePodRoot("")).toThrow(/required/);
    // @ts-expect-error testing runtime guard
    expect(() => normalizePodRoot(undefined)).toThrow(/required/);
  });

  it("rejects a relative URL", () => {
    expect(() => normalizePodRoot("/pod/")).toThrow(/absolute http/);
    expect(() => normalizePodRoot("pod/")).toThrow(/absolute http/);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => normalizePodRoot("ftp://alice.example/pod/")).toThrow(/http/);
    expect(() => normalizePodRoot("file:///etc/passwd/")).toThrow(/http/);
  });

  it("rejects a URL not ending in '/'", () => {
    expect(() => normalizePodRoot("https://alice.example/pod")).toThrow(/end in '\/'/);
  });
});

describe("requirePodScopedUrl", () => {
  const cfg = { podRoot: POD };

  it("accepts an in-pod absolute URL", () => {
    expect(requirePodScopedUrl(cfg, `${POD}notes/a.ttl`)).toBe(`${POD}notes/a.ttl`);
  });

  it("accepts the pod root itself", () => {
    expect(requirePodScopedUrl(cfg, POD)).toBe(POD);
  });

  it("resolves an in-pod relative URL against the pod root", () => {
    expect(requirePodScopedUrl(cfg, "notes/a.ttl")).toBe(`${POD}notes/a.ttl`);
  });

  it("rejects a different-origin URL (SSRF)", () => {
    expect(() => requirePodScopedUrl(cfg, "https://evil.example/x")).toThrow(/pod-scope violation/);
  });

  it("rejects a different host even with matching path", () => {
    expect(() => requirePodScopedUrl(cfg, "https://alice.evil/pod/x")).toThrow(
      /pod-scope violation/,
    );
  });

  it("rejects a path that escapes the root via '..' traversal", () => {
    // Resolves to https://alice.example/secret which is NOT under /pod/.
    expect(() => requirePodScopedUrl(cfg, `${POD}../secret`)).toThrow(/pod-scope violation/);
  });

  it("rejects a path that escapes via encoded traversal once normalised", () => {
    // %2e%2e is decoded by URL into .. — must still be caught.
    expect(() => requirePodScopedUrl(cfg, "../../etc")).toThrow(/pod-scope violation/);
  });

  it("rejects a sibling container that merely shares a prefix string but a different segment", () => {
    // 'https://alice.example/pod-evil/' starts with 'https://alice.example/pod' but
    // NOT with the trailing-slash root 'https://alice.example/pod/'.
    expect(() => requirePodScopedUrl(cfg, "https://alice.example/pod-evil/x")).toThrow(
      /pod-scope violation/,
    );
  });

  it("rejects a non-http(s) scheme target", () => {
    expect(() => requirePodScopedUrl(cfg, "file:///etc/passwd")).toThrow(/pod-scope violation/);
  });

  it("rejects an empty url", () => {
    expect(() => requirePodScopedUrl(cfg, "")).toThrow(/non-empty/);
  });
});

describe("requirePodScopedWriteUrl", () => {
  const cfg = { podRoot: POD }; // POD = "https://alice.example/pod/"

  it("accepts an in-pod resource strictly under the root", () => {
    expect(requirePodScopedWriteUrl(cfg, `${POD}notes/a.ttl`)).toBe(`${POD}notes/a.ttl`);
  });

  it("REJECTS the pod root itself as a write target (allowRoot:false)", () => {
    expect(() => requirePodScopedWriteUrl(cfg, POD)).toThrow(/pod-scope violation/);
  });

  it("REJECTS the slashless base alias as a write target (scope-widening regression guard)", () => {
    // 'https://alice.example/pod' is a resource in the PARENT container, one level
    // ABOVE the configured '…/pod/' sub-tree. assertWithinPodScope treats it as a
    // root alias; under the read default (allowRoot:true) it would be ACCEPTED,
    // widening the write boundary — exactly what the pre-consolidation
    // `startsWith(root)` guard rejected. The write guard must refuse it.
    const slashless = POD.slice(0, -1); // "https://alice.example/pod"
    expect(() => requirePodScopedWriteUrl(cfg, slashless)).toThrow(/pod-scope violation/);
  });

  it("still rejects a different-origin write target (SSRF)", () => {
    expect(() => requirePodScopedWriteUrl(cfg, "https://evil.example/x")).toThrow(
      /pod-scope violation/,
    );
  });
});

describe("writesEnabled", () => {
  const base = { fetch: globalThis.fetch, podRoot: POD };
  it("is false by default (no readOnly set)", () => {
    expect(writesEnabled(base)).toBe(false);
  });
  it("is false when readOnly is true", () => {
    expect(writesEnabled({ ...base, readOnly: true })).toBe(false);
  });
  it("is true only when readOnly is explicitly false", () => {
    expect(writesEnabled({ ...base, readOnly: false })).toBe(true);
  });
});
