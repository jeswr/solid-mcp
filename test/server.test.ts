// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SolidMcpConfig } from "../src/auth.js";
import { createSolidMcpServer } from "../src/server.js";
import { containerTurtle, makeFakePod } from "./fake-pod.js";

const POD = "https://alice.example/pod/";

/** Connect an in-memory client to a server built from `config`. */
async function connect(config: SolidMcpConfig): Promise<Client> {
  const server = createSolidMcpServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function basePod() {
  return makeFakePod({
    [POD]: {
      contentType: "text/turtle",
      body: containerTurtle(POD, [{ name: "notes/", container: true }, { name: "a.ttl" }]),
    },
    [`${POD}a.ttl`]: {
      contentType: "text/turtle",
      body: `@prefix foaf: <http://xmlns.com/foaf/0.1/> .\n<${POD}a.ttl> foaf:name "Alpha" .`,
    },
    [`${POD}notes/`]: {
      contentType: "text/turtle",
      body: containerTurtle(`${POD}notes/`, [{ name: "memo.txt" }]),
    },
    [`${POD}notes/memo.txt`]: { contentType: "text/plain", body: "remember the avocados" },
  });
}

describe("createSolidMcpServer — config validation", () => {
  it("throws eagerly on a bad podRoot", () => {
    expect(() => createSolidMcpServer({ fetch: globalThis.fetch, podRoot: "not-a-url" })).toThrow(
      /absolute http/,
    );
    expect(() =>
      createSolidMcpServer({ fetch: globalThis.fetch, podRoot: "https://x.example/no-slash" }),
    ).toThrow(/end in '\/'/);
  });
});

describe("createSolidMcpServer — tool registration + listing", () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect({ fetch: basePod().fetch, podRoot: POD });
  });
  afterEach(async () => {
    await client.close();
  });

  it("registers the four tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["solid_list", "solid_read", "solid_search", "solid_write"]);
  });

  it("marks read tools readOnlyHint:true and write readOnlyHint:false + destructive", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.solid_list?.annotations?.readOnlyHint).toBe(true);
    expect(byName.solid_read?.annotations?.readOnlyHint).toBe(true);
    expect(byName.solid_search?.annotations?.readOnlyHint).toBe(true);
    expect(byName.solid_write?.annotations?.readOnlyHint).toBe(false);
    expect(byName.solid_write?.annotations?.destructiveHint).toBe(true);
  });

  it("registers a resource template and lists the pod root children", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain(`${POD}a.ttl`);
    expect(uris).toContain(`${POD}notes/`);
  });
});

describe("tools — happy paths", () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect({ fetch: basePod().fetch, podRoot: POD });
  });
  afterEach(async () => {
    await client.close();
  });

  it("solid_list returns the container children", async () => {
    const res = await client.callTool({ name: "solid_list", arguments: { container: POD } });
    expect(res.isError).toBeFalsy();
    const text = textOf(res as { content: Array<{ type: string; text?: string }> });
    expect(text).toContain("a.ttl");
    expect(text).toContain("notes/");
  });

  it("solid_read returns Turtle for an RDF resource", async () => {
    const res = await client.callTool({ name: "solid_read", arguments: { url: `${POD}a.ttl` } });
    expect(res.isError).toBeFalsy();
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toContain("Alpha");
  });

  it("solid_read returns text for a plain resource", async () => {
    const res = await client.callTool({
      name: "solid_read",
      arguments: { url: `${POD}notes/memo.txt` },
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toContain(
      "avocados",
    );
  });

  it("solid_search finds a literal match", async () => {
    const res = await client.callTool({ name: "solid_search", arguments: { query: "Alpha" } });
    expect(res.isError).toBeFalsy();
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toContain("a.ttl");
  });
});

describe("tools — scope guard", () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect({ fetch: basePod().fetch, podRoot: POD });
  });
  afterEach(async () => {
    await client.close();
  });

  it("solid_read returns isError for an out-of-pod url (SSRF)", async () => {
    const res = await client.callTool({
      name: "solid_read",
      arguments: { url: "https://evil.example/x" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toMatch(
      /pod-scope violation/,
    );
  });

  it("solid_list returns isError for an out-of-pod container", async () => {
    const res = await client.callTool({
      name: "solid_list",
      arguments: { container: "https://evil.example/" },
    });
    expect(res.isError).toBe(true);
  });
});

describe("tools — fail-closed on unauthenticated read", () => {
  it("solid_read returns isError when the resource is 401", async () => {
    const pod = makeFakePod({
      [`${POD}secret`]: { contentType: "text/plain", body: "no", status: 401 },
    });
    const client = await connect({ fetch: pod.fetch, podRoot: POD });
    try {
      const res = await client.callTool({ name: "solid_read", arguments: { url: `${POD}secret` } });
      expect(res.isError).toBe(true);
      expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toMatch(
        /unauthenticated\/forbidden/,
      );
    } finally {
      await client.close();
    }
  });
});

describe("solid_write — read-only default + opt-in", () => {
  it("returns isError (NOT throwing) when read-only by default", async () => {
    const pod = makeFakePod({});
    const client = await connect({ fetch: pod.fetch, podRoot: POD });
    try {
      const res = await client.callTool({
        name: "solid_write",
        arguments: { url: `${POD}new.ttl`, content: "x", contentType: "text/turtle" },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toMatch(
        /write disabled.*read-only/,
      );
      expect(pod.puts.length).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("succeeds and PUTs when readOnly:false", async () => {
    const pod = makeFakePod({});
    const client = await connect({ fetch: pod.fetch, podRoot: POD, readOnly: false });
    try {
      const res = await client.callTool({
        name: "solid_write",
        arguments: { url: `${POD}new.ttl`, content: "hello", contentType: "text/turtle" },
      });
      expect(res.isError).toBeFalsy();
      expect(pod.puts.length).toBe(1);
      expect(pod.puts[0]?.url).toBe(`${POD}new.ttl`);
      expect(pod.puts[0]?.body).toBe("hello");
    } finally {
      await client.close();
    }
  });

  it("read-only default holds even with no readOnly key present (explicit)", async () => {
    const pod = makeFakePod({});
    const config: SolidMcpConfig = { fetch: pod.fetch, podRoot: POD };
    expect("readOnly" in config).toBe(false);
    const client = await connect(config);
    try {
      const res = await client.callTool({
        name: "solid_write",
        arguments: { url: `${POD}x.ttl`, content: "x", contentType: "text/turtle" },
      });
      expect(res.isError).toBe(true);
      expect(pod.puts.length).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("write still scope-guards even when writes are enabled", async () => {
    const pod = makeFakePod({});
    const client = await connect({ fetch: pod.fetch, podRoot: POD, readOnly: false });
    try {
      const res = await client.callTool({
        name: "solid_write",
        arguments: { url: "https://evil.example/x", content: "y", contentType: "text/plain" },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res as { content: Array<{ type: string; text?: string }> })).toMatch(
        /pod-scope violation/,
      );
      expect(pod.puts.length).toBe(0);
    } finally {
      await client.close();
    }
  });
});

describe("resource read callback", () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect({ fetch: basePod().fetch, podRoot: POD });
  });
  afterEach(async () => {
    await client.close();
  });

  it("reads a container as a JSON listing", async () => {
    const res = await client.readResource({ uri: POD });
    const first = res.contents[0] as { mimeType?: string; text?: string };
    expect(first?.mimeType).toBe("application/json");
    expect(first?.text).toContain("a.ttl");
  });

  it("reads an RDF resource as Turtle", async () => {
    const res = await client.readResource({ uri: `${POD}a.ttl` });
    const first = res.contents[0] as { mimeType?: string; text?: string };
    expect(first?.mimeType).toBe("text/turtle");
    expect(first?.text).toContain("Alpha");
  });

  it("reads a plain text resource as text", async () => {
    const res = await client.readResource({ uri: `${POD}notes/memo.txt` });
    const first = res.contents[0] as { text?: string };
    expect(first?.text).toContain("avocados");
  });
});
