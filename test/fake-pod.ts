// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * A fake-pod `fetch` for tests. `makeFakePod(resources)` returns a fetch-shaped
 * function that serves the given resources by URL. Each resource is
 * `{ contentType, body, status?, etag? }`. PUTs are recorded so write tests can
 * assert the request, and a resource map can be supplied to make PUT update the
 * served map. Unknown URLs return 404.
 */

export interface FakeResource {
  contentType: string;
  body: string;
  status?: number;
  etag?: string;
  /** If set, the GET returns a 30x to this Location (to model redirect SSRF). */
  redirectTo?: string;
  /** The redirect status to use with `redirectTo` (default 302). */
  redirectStatus?: number;
}

export interface PutRecord {
  url: string;
  method: string;
  contentType: string | null;
  body: string;
}

export interface FakePod {
  fetch: typeof fetch;
  puts: PutRecord[];
}

/** Build a fetch-shaped function serving `resources`. */
export function makeFakePod(resources: Record<string, FakeResource>): FakePod {
  const puts: PutRecord[] = [];
  const map = { ...resources };

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "PUT") {
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      const contentType = headers.get("content-type");
      puts.push({ url, method, contentType, body });
      // Reflect the write into the served map (so a subsequent GET sees it).
      map[url] = { contentType: contentType ?? "text/plain", body, etag: '"new"' };
      return new Response(null, { status: 201, headers: { etag: '"new"' } });
    }

    const res = map[url];
    if (!res) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    // Model a redirect (3xx + Location) so the scopedFetch redirect guard can be
    // exercised. The caller (scopedFetch) requests redirect:"manual" and inspects
    // the Location itself, so we just return the 30x response verbatim.
    if (res.redirectTo) {
      return new Response(null, {
        status: res.redirectStatus ?? 302,
        headers: { location: res.redirectTo },
      });
    }
    const status = res.status ?? 200;
    const headers = new Headers({ "content-type": res.contentType });
    if (res.etag) headers.set("etag", res.etag);
    if (status >= 400) {
      return new Response(res.body, { status, statusText: statusTextFor(status), headers });
    }
    return new Response(res.body, { status, headers });
  }) as typeof fetch;

  return { fetch: fakeFetch, puts };
}

function statusTextFor(status: number): string {
  switch (status) {
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 500:
      return "Internal Server Error";
    default:
      return "Error";
  }
}

/**
 * Build a Turtle container listing for `base` with the given children. Used to
 * exercise the REAL fetch-rdf + @solid/object parse path (we do NOT mock parsing).
 * Each child is `{ name, container? }`.
 */
export function containerTurtle(
  base: string,
  children: Array<{ name: string; container?: boolean }>,
): string {
  const lines: string[] = [
    "@prefix ldp: <http://www.w3.org/ns/ldp#> .",
    "@prefix dcterms: <http://purl.org/dc/terms/> .",
    "",
    `<${base}> a ldp:Container, ldp:BasicContainer, ldp:Resource ;`,
  ];
  const contains = children.map((c) => `<${base}${c.name}>`).join(", ");
  if (contains) {
    lines.push(`  ldp:contains ${contains} .`);
  } else {
    lines.push('  dcterms:modified "2024-01-01T00:00:00Z" .');
  }
  lines.push("");
  for (const c of children) {
    const t = c.container ? "ldp:Container, ldp:BasicContainer, ldp:Resource" : "ldp:Resource";
    lines.push(`<${base}${c.name}> a ${t} .`);
  }
  return lines.join("\n");
}

/**
 * Build a Turtle container listing whose `ldp:contains` entries are ARBITRARY
 * absolute URLs (used to model a POISONED listing that points a child at an
 * external origin — the SSRF attack surface). `childUrls` are written verbatim.
 */
export function poisonedContainerTurtle(base: string, childUrls: string[]): string {
  const lines: string[] = [
    "@prefix ldp: <http://www.w3.org/ns/ldp#> .",
    "",
    `<${base}> a ldp:Container, ldp:BasicContainer, ldp:Resource ;`,
    `  ldp:contains ${childUrls.map((u) => `<${u}>`).join(", ")} .`,
    "",
  ];
  for (const u of childUrls) {
    lines.push(`<${u}> a ldp:Resource .`);
  }
  return lines.join("\n");
}
