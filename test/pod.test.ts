// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import type { SolidMcpConfig } from "../src/auth.js";
import { listContainer, readRdf, readResource, search, writeResource } from "../src/pod.js";
import { containerTurtle, makeFakePod, poisonedContainerTurtle } from "./fake-pod.js";

/** Wrap a fetch to record every requested URL (to assert an SSRF target is NOT hit). */
function recordingFetch(inner: typeof globalThis.fetch): {
  fetch: typeof globalThis.fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(u);
    return inner(input, init);
  }) as typeof globalThis.fetch;
  return { fetch: wrapped, urls };
}

const POD = "https://alice.example/pod/";

function cfg(fetch: typeof globalThis.fetch, extra: Partial<SolidMcpConfig> = {}): SolidMcpConfig {
  return { fetch, podRoot: POD, ...extra };
}

describe("listContainer", () => {
  it("parses a real Turtle ldp:contains listing into typed children", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [
          { name: "notes/", container: true },
          { name: "a.ttl" },
          { name: "photo.png" },
        ]),
      },
    });
    const children = await listContainer(cfg(pod.fetch), POD);
    const byUrl = Object.fromEntries(children.map((c) => [c.url, c]));
    expect(children.length).toBe(3);
    expect(byUrl[`${POD}notes/`]?.isContainer).toBe(true);
    expect(byUrl[`${POD}a.ttl`]?.isContainer).toBe(false);
    expect(byUrl[`${POD}a.ttl`]?.name).toBe("a.ttl");
    expect(byUrl[`${POD}photo.png`]?.name).toBe("photo.png");
  });

  it("returns [] for an empty container", async () => {
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    expect(await listContainer(cfg(pod.fetch), POD)).toEqual([]);
  });

  it("rejects an out-of-pod container (scope guard)", async () => {
    const pod = makeFakePod({});
    await expect(listContainer(cfg(pod.fetch), "https://evil.example/")).rejects.toThrow(
      /pod-scope violation/,
    );
  });

  it("DROPS a poisoned ldp:contains entry that points outside the pod (SSRF)", async () => {
    // The container lists an in-pod child AND an external child — the latter must
    // be dropped from the returned listing (fail-closed).
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: poisonedContainerTurtle(POD, [`${POD}ok.ttl`, "https://evil.example/secret"]),
      },
    });
    const children = await listContainer(cfg(pod.fetch), POD);
    const urls = children.map((c) => c.url);
    expect(urls).toContain(`${POD}ok.ttl`);
    expect(urls).not.toContain("https://evil.example/secret");
    expect(urls.every((u) => u.startsWith(POD))).toBe(true);
  });

  it("DROPS a poisoned same-origin entry that escapes the pod root", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: poisonedContainerTurtle(POD, [
          `${POD}ok.ttl`,
          "https://alice.example/other-pod/leak.ttl",
        ]),
      },
    });
    const urls = (await listContainer(cfg(pod.fetch), POD)).map((c) => c.url);
    expect(urls).toEqual([`${POD}ok.ttl`]);
  });
});

describe("readResource", () => {
  it("returns text for a textual content-type", async () => {
    const pod = makeFakePod({
      [`${POD}a.txt`]: { contentType: "text/plain", body: "hello world", etag: '"v1"' },
    });
    const r = await readResource(cfg(pod.fetch), `${POD}a.txt`);
    expect(r.text).toBe("hello world");
    expect(r.base64).toBeUndefined();
    expect(r.contentType).toBe("text/plain");
    expect(r.etag).toBe('"v1"');
  });

  it("treats application/json and +json as text", async () => {
    const pod = makeFakePod({
      [`${POD}d.json`]: { contentType: "application/json", body: '{"a":1}' },
      [`${POD}d.jsonld`]: { contentType: "application/ld+json", body: '{"@id":"x"}' },
    });
    expect((await readResource(cfg(pod.fetch), `${POD}d.json`)).text).toBe('{"a":1}');
    expect((await readResource(cfg(pod.fetch), `${POD}d.jsonld`)).text).toBe('{"@id":"x"}');
  });

  it("returns base64 for a binary content-type", async () => {
    const pod = makeFakePod({
      [`${POD}p.png`]: { contentType: "image/png", body: "BIN" },
    });
    const r = await readResource(cfg(pod.fetch), `${POD}p.png`);
    expect(r.text).toBeUndefined();
    expect(r.base64).toBe(Buffer.from("BIN").toString("base64"));
    expect(r.contentType).toBe("image/png");
  });

  it("strips content-type params to the bare media type", async () => {
    const pod = makeFakePod({
      [`${POD}a.txt`]: { contentType: "text/plain; charset=utf-8", body: "x" },
    });
    expect((await readResource(cfg(pod.fetch), `${POD}a.txt`)).contentType).toBe("text/plain");
  });

  it("fails CLOSED on 401", async () => {
    const pod = makeFakePod({
      [`${POD}priv`]: { contentType: "text/plain", body: "no", status: 401 },
    });
    await expect(readResource(cfg(pod.fetch), `${POD}priv`)).rejects.toThrow(
      /unauthenticated\/forbidden \(401\).*authenticated fetch/s,
    );
  });

  it("fails CLOSED on 403", async () => {
    const pod = makeFakePod({
      [`${POD}priv`]: { contentType: "text/plain", body: "no", status: 403 },
    });
    await expect(readResource(cfg(pod.fetch), `${POD}priv`)).rejects.toThrow(
      /unauthenticated\/forbidden \(403\)/,
    );
  });

  it("throws with status on a generic non-2xx", async () => {
    const pod = makeFakePod({
      [`${POD}gone`]: { contentType: "text/plain", body: "x", status: 500 },
    });
    await expect(readResource(cfg(pod.fetch), `${POD}gone`)).rejects.toThrow(/HTTP 500/);
  });

  it("scope-guards the url", async () => {
    const pod = makeFakePod({});
    await expect(readResource(cfg(pod.fetch), "https://evil.example/x")).rejects.toThrow(
      /pod-scope violation/,
    );
  });

  it("BLOCKS an in-pod URL that redirects to an external target (redirect SSRF)", async () => {
    const pod = makeFakePod({
      [`${POD}redir`]: {
        contentType: "text/plain",
        body: "",
        redirectTo: "https://evil.example/loot",
      },
    });
    const rec = recordingFetch(pod.fetch);
    await expect(readResource(cfg(rec.fetch), `${POD}redir`)).rejects.toThrow(
      /pod-scope violation.*redirected/s,
    );
    // The external target must never be requested.
    expect(rec.urls).not.toContain("https://evil.example/loot");
  });

  it("FOLLOWS an in-pod redirect to another in-pod resource", async () => {
    const pod = makeFakePod({
      [`${POD}old`]: { contentType: "text/plain", body: "", redirectTo: `${POD}new` },
      [`${POD}new`]: { contentType: "text/plain", body: "moved here" },
    });
    const r = await readResource(cfg(pod.fetch), `${POD}old`);
    expect(r.text).toBe("moved here");
  });

  it("BLOCKS a same-origin redirect that escapes the pod root", async () => {
    const pod = makeFakePod({
      [`${POD}r`]: {
        contentType: "text/plain",
        body: "",
        redirectTo: "https://alice.example/other/secret",
      },
    });
    await expect(readResource(cfg(pod.fetch), `${POD}r`)).rejects.toThrow(
      /pod-scope violation.*redirected/s,
    );
  });
});

describe("readRdf", () => {
  it("returns a Turtle serialisation of the resource graph", async () => {
    const ttl = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .\n<${POD}me> foaf:name "Alice" .`;
    const pod = makeFakePod({
      [`${POD}me`]: { contentType: "text/turtle", body: ttl },
    });
    const r = await readRdf(cfg(pod.fetch), `${POD}me`);
    expect(r.turtle).toContain("Alice");
    expect(r.turtle).toContain("foaf");
    expect(r.dataset.size).toBe(1);
  });
});

describe("search", () => {
  it("finds matches by resource name via a container scan", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [{ name: "shopping-list.ttl" }, { name: "other.ttl" }]),
      },
      [`${POD}shopping-list.ttl`]: { contentType: "text/turtle", body: "" },
      [`${POD}other.ttl`]: { contentType: "text/turtle", body: "" },
    });
    const hits = await search(cfg(pod.fetch), "shopping");
    expect(hits.map((h) => h.url)).toContain(`${POD}shopping-list.ttl`);
    expect(hits.map((h) => h.url)).not.toContain(`${POD}other.ttl`);
  });

  it("finds matches by RDF literal value", async () => {
    const ttl = `@prefix schema: <http://schema.org/> .\n<${POD}note> schema:text "Buy avocados today" .`;
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [{ name: "note.ttl" }]),
      },
      [`${POD}note.ttl`]: { contentType: "text/turtle", body: ttl },
    });
    const hits = await search(cfg(pod.fetch), "avocado");
    const hit = hits.find((h) => h.url === `${POD}note.ttl`);
    expect(hit).toBeDefined();
    expect(hit?.snippet).toContain("avocados");
  });

  it("recurses into sub-containers up to maxDepth", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [{ name: "sub/", container: true }]),
      },
      [`${POD}sub/`]: {
        contentType: "text/turtle",
        body: containerTurtle(`${POD}sub/`, [{ name: "deep-treasure.ttl" }]),
      },
      [`${POD}sub/deep-treasure.ttl`]: { contentType: "text/turtle", body: "" },
    });
    const hits = await search(cfg(pod.fetch), "treasure");
    expect(hits.map((h) => h.url)).toContain(`${POD}sub/deep-treasure.ttl`);
  });

  it("respects maxDepth (does not descend past the cap)", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [{ name: "sub/", container: true }]),
      },
      [`${POD}sub/`]: {
        contentType: "text/turtle",
        body: containerTurtle(`${POD}sub/`, [{ name: "treasure.ttl" }]),
      },
      [`${POD}sub/treasure.ttl`]: { contentType: "text/turtle", body: "" },
    });
    // maxDepth 0 → only the root container's direct children are visited; the
    // 'sub/' container is seen (and name-matched if relevant) but NOT descended.
    const hits = await search(cfg(pod.fetch), "treasure", { maxDepth: 0 });
    expect(hits.map((h) => h.url)).not.toContain(`${POD}sub/treasure.ttl`);
  });

  it("respects maxResources (stops the scan at the cap)", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `r${i}.ttl` }));
    const resources: Record<string, { contentType: string; body: string }> = {
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, many) },
    };
    for (const m of many) {
      resources[`${POD}${m.name}`] = { contentType: "text/turtle", body: "" };
    }
    const pod = makeFakePod(resources);
    // Cap at 3 visited; we still must not throw and must return at most matches
    // among the first 3 visited (names all contain 'r').
    const hits = await search(cfg(pod.fetch), "r", { maxResources: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it("returns [] for an empty query", async () => {
    const pod = makeFakePod({});
    expect(await search(cfg(pod.fetch), "   ")).toEqual([]);
  });

  it("scope-guards an out-of-pod scope option", async () => {
    const pod = makeFakePod({});
    await expect(search(cfg(pod.fetch), "x", { scope: "https://evil.example/" })).rejects.toThrow(
      /pod-scope violation/,
    );
  });

  it("NEVER fetches an external URL listed in a poisoned container (SSRF)", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: poisonedContainerTurtle(POD, [`${POD}note.ttl`, "https://evil.example/exfil.ttl"]),
      },
      [`${POD}note.ttl`]: { contentType: "text/turtle", body: "" },
      // If the guard failed, search would GET this — its presence would be the bug.
      "https://evil.example/exfil.ttl": { contentType: "text/turtle", body: "" },
    });
    const rec = recordingFetch(pod.fetch);
    await search(cfg(rec.fetch), "exfil");
    expect(rec.urls).not.toContain("https://evil.example/exfil.ttl");
    expect(rec.urls.every((u) => u.startsWith(POD))).toBe(true);
  });

  it("NEVER fetches an external type-index pointed to by a malicious profile (SSRF)", async () => {
    const webId = `${POD}profile/card#me`;
    const Solid = "http://www.w3.org/ns/solid/terms#";
    // The profile points publicTypeIndex at an EXTERNAL origin — must not be fetched.
    const profile = `<${webId}> <${Solid}publicTypeIndex> <https://evil.example/typeIndex.ttl> .`;
    const pod = makeFakePod({
      [webId]: { contentType: "text/turtle", body: profile },
      "https://evil.example/typeIndex.ttl": {
        contentType: "text/turtle",
        body: `<#r> <${Solid}instanceContainer> <https://evil.example/loot/> .`,
      },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const rec = recordingFetch(pod.fetch);
    await search(cfg(rec.fetch, { webId }), "anything");
    expect(rec.urls).not.toContain("https://evil.example/typeIndex.ttl");
    // The WebID profile itself IS fetched (configured identity), but nothing on evil.example.
    expect(rec.urls.some((u) => u.startsWith("https://evil.example"))).toBe(false);
    expect(rec.urls).toContain(webId);
  });

  it("uses Type-Index hints when a webId is configured (best-effort)", async () => {
    const webId = `${POD}profile/card#me`;
    const Solid = "http://www.w3.org/ns/solid/terms#";
    const profile = `<${webId}> <${Solid}publicTypeIndex> <${POD}settings/publicTypeIndex.ttl> .`;
    const index = `<#reg> <${Solid}instanceContainer> <${POD}bookmarks/> .`;
    const pod = makeFakePod({
      [webId]: { contentType: "text/turtle", body: profile },
      [`${POD}settings/publicTypeIndex.ttl`]: { contentType: "text/turtle", body: index },
      // The hinted container is NOT under the default-scope listing of POD, but the
      // type-index seed should make the scan visit it directly.
      [`${POD}bookmarks/`]: {
        contentType: "text/turtle",
        body: containerTurtle(`${POD}bookmarks/`, [{ name: "favorite-thing.ttl" }]),
      },
      [`${POD}bookmarks/favorite-thing.ttl`]: { contentType: "text/turtle", body: "" },
      // Default root scope is empty so only the type-index seed can find the hit.
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const hits = await search(cfg(pod.fetch, { webId }), "favorite");
    expect(hits.map((h) => h.url)).toContain(`${POD}bookmarks/favorite-thing.ttl`);
  });
});

describe("writeResource", () => {
  it("THROWS when read-only by default", async () => {
    const pod = makeFakePod({});
    await expect(
      writeResource(cfg(pod.fetch), `${POD}new.ttl`, "x", "text/turtle"),
    ).rejects.toThrow(/write disabled.*read-only/);
    expect(pod.puts.length).toBe(0);
  });

  it("THROWS when readOnly:true explicitly", async () => {
    const pod = makeFakePod({});
    await expect(
      writeResource(cfg(pod.fetch, { readOnly: true }), `${POD}new.ttl`, "x", "text/turtle"),
    ).rejects.toThrow(/write disabled/);
  });

  it("PUTs when readOnly:false", async () => {
    const pod = makeFakePod({});
    const r = await writeResource(
      cfg(pod.fetch, { readOnly: false }),
      `${POD}new.ttl`,
      "hello",
      "text/turtle",
    );
    expect(r.url).toBe(`${POD}new.ttl`);
    expect(pod.puts.length).toBe(1);
    expect(pod.puts[0]?.url).toBe(`${POD}new.ttl`);
    expect(pod.puts[0]?.contentType).toBe("text/turtle");
    expect(pod.puts[0]?.body).toBe("hello");
  });

  it("scope-guards the url even with writes enabled", async () => {
    const pod = makeFakePod({});
    await expect(
      writeResource(
        cfg(pod.fetch, { readOnly: false }),
        "https://evil.example/x",
        "y",
        "text/plain",
      ),
    ).rejects.toThrow(/pod-scope violation/);
    expect(pod.puts.length).toBe(0);
  });

  it("fails closed on a 403 write", async () => {
    // A fetch that returns 403 on PUT (the pod denied write access).
    const denying = (async () =>
      new Response("no", { status: 403, statusText: "Forbidden" })) as typeof fetch;
    await expect(
      writeResource(cfg(denying, { readOnly: false }), `${POD}new.ttl`, "x", "text/turtle"),
    ).rejects.toThrow(/unauthenticated\/forbidden \(403\)/);
  });

  it("throws with status on a generic non-2xx write", async () => {
    const failing = (async () =>
      new Response("boom", { status: 500, statusText: "Internal Server Error" })) as typeof fetch;
    await expect(
      writeResource(cfg(failing, { readOnly: false }), `${POD}new.ttl`, "x", "text/turtle"),
    ).rejects.toThrow(/HTTP 500/);
  });
});
