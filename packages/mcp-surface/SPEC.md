# MCP surface fingerprint — canonical form `mcp-surface/1`

This document is the contract. A host, registry or auditor that implements it computes the same
sha256 as `@sbissoli/mcp-surface` for the same server, without running or reading that package.
[`exemplos/verify.mjs`](exemplos/verify.mjs) is a second implementation written from this text
(no dependencies), and the package's tests require both to agree, including on the test vector
in §7.

The idea and the scope come from two readers of
[the replay article](https://dev.to/sidneybissoli/your-mcp-server-changed-its-version-didnt-heres-how-to-catch-it-3ai5):
publish the fingerprint with each release so that a client can check it, and publish only what a
stranger can reproduce without a credential.

## 1. Capture

Over Streamable HTTP, stateless, no credential: each request is a `POST` with
`Content-Type: application/json` and `Accept: application/json, text/event-stream`. The response
body is either one JSON-RPC message or an SSE stream; with SSE, the message is the JSON in the
last `data:` line. Over stdio, one JSON-RPC message per line.

1. `initialize` with exactly these params:
   `{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":<any>,"version":<any>}}`.
   The protocol version is fixed because the `capabilities` a server answers depend on it.
   `clientInfo` does not enter the fingerprint; a server whose surface varies with it is out of
   scope.
2. On a transport with a session (stdio), send `notifications/initialized`.
3. `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`, each first with
   params `{}`, then `{"cursor": <nextCursor>}` while the result carries a non-empty string
   `nextCursor`; the pages are concatenated in order. At most 100 pages.

A method **is not served** when the request fails, the response carries no `result`, the
`result` does not have the list under its key (`tools`, `resources`, `resourceTemplates`,
`prompts`), any page fails, or the page limit is reached. Not served is `null`, never `[]`:
"serves nothing" and "does not serve" are different surfaces.

## 2. The declared surface

```json
{
  "initialize": {
    "protocolVersion": <initialize.result.protocolVersion, or null>,
    "capabilities":    <initialize.result.capabilities, or null>,
    "instructions":    <initialize.result.instructions, or null>,
    "serverInfo":      <initialize.result.serverInfo without the "version" key, or {}>
  },
  "tools":             <tools, sorted by "name">,
  "resources":         <resources, sorted by "uri">,
  "resourceTemplates": <resource templates, sorted by "uriTemplate">,
  "prompts":           <prompts, sorted by "name">
}
```

- The server version leaves `serverInfo`: it is what the fingerprint is compared against. The
  rest of `serverInfo` (name, title, website, icons) stays.
- Each list is sorted by the string value of its key, compared by **UTF-16 code unit** (the order
  of JavaScript's default `Array.prototype.sort` on strings; in Python,
  `sorted(..., key=lambda s: s.encode("utf-16-be"))`). Never a locale-aware comparison. Ties keep
  the order of capture.
- Arrays nested inside items (`required`, `enum`, …) keep the server's order: it is part of what
  the server publishes.
- Items are kept whole, every field the server sends.

## 3. Serialisation and hash

1. Sort the keys of every object, recursively, by UTF-16 code unit. Arrays keep their order.
2. Serialise as JSON without whitespace, with strings and numbers as ECMAScript's
   `JSON.stringify` writes them. For these documents this is the JSON Canonicalization Scheme,
   [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
3. sha256 of the UTF-8 bytes, as 64 lowercase hex characters.

## 4. Anonymous answers

Which methods answer **without a credential**, on the published endpoint, in the configuration
that runs in production. This is behaviour no listing shows.

| Method | Request |
|---|---|
| `initialize` | as in §1 |
| `ping`, `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` | no params |
| `tools/call` | only when the publisher names the call (`anonymous.call`): a tool that does not depend on the upstream source, so the probe measures the edge and not the source's mood |

Each request is sent alone, stateless, with no credential. A method **answers** when the HTTP
status is 200 and the JSON-RPC message carries a `result`. The fingerprint of this part is the
§3 sha256 of the object `{ method: true | false }` over the methods listed.

## 5. Where it is published

In `server.json`, so that the [MCP Registry](https://registry.modelcontextprotocol.io) stores it
with the version (the registry keeps only the `publisher-provided` key of `_meta`, up to 4096
bytes):

```json
"_meta": {
  "io.modelcontextprotocol.registry/publisher-provided": {
    "io.github.sidneybissoli/mcp-surface": {
      "form": "mcp-surface/1",
      "spec": "https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-surface/SPEC.md",
      "endpoint": "https://bcb.sidneybissoli.com/mcp",
      "declared": { "sha256": "<64 hex>", "lockedAt": "1.16.0" },
      "anonymous": {
        "sha256": "<64 hex>",
        "answers": { "initialize": true, "ping": true, "tools/list": true, "…": true },
        "call": { "name": "bcb_series_populares", "arguments": {} }
      }
    }
  }
}
```

- `endpoint` is one of the entry's `remotes`; `anonymous` was measured there.
- `declared` holds for **every transport** of that version, including the stdio package.
- `lockedAt` is the version under which this surface was first locked. It may be older than the
  entry's version: a release that does not change the surface keeps the fingerprint.

## 6. Checking it (what a host does)

1. Read the entry for the version being installed:
   `GET https://registry.modelcontextprotocol.io/v0.1/servers/{name}/versions/{version}`, then
   `server._meta["io.modelcontextprotocol.registry/publisher-provided"]["io.github.sidneybissoli/mcp-surface"]`.
   An unknown `form` cannot be checked; it is not a mismatch.
2. Capture (§1), normalise (§2) and hash (§3) on first connect; compare with `declared.sha256`.
3. Optionally repeat the probes of §4 and compare with `anonymous.answers`.
4. On a mismatch, refuse or ask the user to approve again: the server now differs from the one
   the registry describes for that version.

`node exemplos/verify.mjs <name> [version]` does steps 1–3 and exits 1 on a mismatch.

## 7. Test vector

This raw capture:

```json
{
  "initialize": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "tools": { "listChanged": true } },
    "serverInfo": { "name": "exemplo", "version": "9.9.9" }
  },
  "tools": [
    { "name": "b_tool", "inputSchema": { "type": "object", "required": ["z", "a"] } },
    { "name": "B_tool", "inputSchema": { "type": "object" } },
    { "name": "a_tool", "description": "Ç", "inputSchema": { "type": "object" } }
  ],
  "resources": [],
  "resourceTemplates": null,
  "prompts": null
}
```

(`resources` served and empty; templates and prompts not served.) Its canonical form serialises
to:

```
{"initialize":{"capabilities":{"tools":{"listChanged":true}},"instructions":null,"protocolVersion":"2025-06-18","serverInfo":{"name":"exemplo"}},"prompts":null,"resourceTemplates":null,"resources":[],"tools":[{"inputSchema":{"type":"object"},"name":"B_tool"},{"description":"Ç","inputSchema":{"type":"object"},"name":"a_tool"},{"inputSchema":{"required":["z","a"],"type":"object"},"name":"b_tool"}]}
```

and its sha256 is `06c6e65c1e1a1e00d7659498e41bb0cd2fe76fe5248f3a92d2d05ddfc01351d8`.

What the vector exercises: `tools` in code-unit order (`B` 0x42 < `a` 0x61 < `b` 0x62; a
locale-aware sort puts `B_tool` after `a_tool` and gives another hash); `required` keeping the
server's order (`z` before `a`); the `version` gone from `serverInfo`; `instructions` absent
becoming `null`; a non-ASCII character hashed as UTF-8; `[]` and `null` kept apart.

## 8. What it does not prove

- It is published by the same party that publishes the server. It catches drift and forgotten
  bumps — the surface changed and the version did not — not a dishonest publisher.
- It covers the surface, not behaviour: tool results, resource contents and upstream data are
  outside it.
- It says nothing about versions published before the fingerprint was.

## 9. Changes to this form

Any change that can alter a sha256 for the same server gets a new form identifier
(`mcp-surface/2`) and a CHANGELOG entry; the old identifier keeps its meaning. Changes that
cannot alter a hash (wording, examples) keep the identifier.
