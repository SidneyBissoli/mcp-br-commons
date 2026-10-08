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

**A list that changes on its own does not belong in the declared surface.** The fingerprint is
a promise that the surface changes only with the version. A list built from data that changes
over time — a `resources/list` of stories, records or daily files — would break that promise
every day without anything actually breaking, and teach hosts to ignore the mismatch. Such a
server serves the changing items outside the four lists (through a resource template, whose
`uriTemplate` is stable, or a tool). `mcp-surface/1` has no way to leave one list out of the
hash, so a server that keeps a changing list does not publish this form.
This cut comes from Valentina Koniukhova's implementation in worklore, which leaves
`resources/list` out for exactly this reason. None of the seven servers that publish this form
today has such a list (measured on 2026-10-07: every resource list is fixed in code).

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
2. Before comparing anything, call a method no server serves (`mcp-surface/metodo-que-nao-existe`).
   An endpoint that answers it with a `result` says yes to everything — a proxy, a test double, an
   edge that swallows errors — and nothing measured after it would mean anything: stop, and report
   that, not a mismatch. Any JSON-RPC error, or any answer without `result`, counts as saying no.
3. Capture (§1), normalise (§2) and hash (§3) on first connect; compare with `declared.sha256`.
4. Optionally repeat the probes of §4 and compare with `anonymous.answers`.
5. On a mismatch, refuse or ask the user to approve again: the server now differs from the one
   the registry describes for that version.

`node exemplos/verify.mjs <name> [version]` does steps 1–4 and exits 1 on a mismatch, or when
step 2 fails.

### 6.1 Checking it against the source

Steps 1–4 show that the live server is what the registry published for that version. They do
not show that the published hash is the one the **public source** produces: the hash is declared
by the publisher. For a server that adopts `@sbissoli/mcp-surface`, anyone can close that gap
from the tagged source, with no access to the publisher's machine or CI:

```sh
git clone --depth 1 --branch v<version> <repository> && cd <repository>
npm ci && npm test        # the lock tests: the surface captured from THIS source = surface.lock.json,
                          # and server.json publishes what the lock holds
node -p "require('./surface.lock.json').declarada.sha256"   # = declared.sha256 in the registry entry
```

The lock test captures the surface from the source in memory (not from a build the publisher
shipped), and the `server.json` test fails when the published block differs from the lock. A
registry hash that does not match the tag's lock means the entry was not published from that
source. Measured on 2026-10-07 for `bcb-br-mcp` 1.16.2 from a clean clone: lock, `server.json` and
registry entry carry the same `ff0973f91573…`.

### 6.2 The promise holds per response, not per connection

Step 3 checks the surface once, on connect. A server can answer `tools/list` one way at the start
of a session and another way later, and the MCP spec only says it SHOULD send
`notifications/tools/list_changed` when that happens; a server that wants to switch quietly just
won't. So a host that checks should check every list response it acts on, not only the first:

1. Assemble the complete list, following `nextCursor` to the last page (§1). A single page is not
   the list.
2. Put it in place of the same list in the surface captured on connect, keeping `initialize` and
   the other lists as captured (or re-fetch them too).
3. Normalise (§2) and hash (§3) the whole surface again, and compare with `declared.sha256`.

The published hash covers the whole surface, never a list on its own, so a list response is not
hashed by itself: it is checked by recomputing the surface with it in place. This needs no new
field and no new form. Treat a mismatch found mid-session exactly like one found on connect
(step 5). The same applies to `resources/list`, `resources/templates/list` and `prompts/list`.

Raised by a reader of the article that introduced this form (dev.to, comment 3gpa6, 2026-10-08).
`exemplos/verify.mjs` is a one-shot check run outside any session, so it does not do this; it is
what a host does inside one.

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

- It cannot tell a host that a declared tool is benign. It proves that what the host runs is
  what the registry published for that version (the registry does not let a published version's
  metadata change), and, with §6.1, that the hash is the public source's. Judging what the surface
  does stays a human decision on re-approval.
- Without §6.1 the hash is the publisher's word. Not done, recorded as an idea: a signed
  attestation (Sigstore, through the CI's OIDC identity, as npm provenance does) binding the hash
  to the commit and the workflow, so a host could check it without rebuilding. It waits for a
  host that verifies such attestations.
- It covers the surface, not behaviour: tool results, resource contents and upstream data are
  outside it.
- It says nothing about versions published before the fingerprint was.

## 9. Changes to this form

Any change that can alter a sha256 for the same server gets a new form identifier
(`mcp-surface/2`) and a CHANGELOG entry; the old identifier keeps its meaning. Changes that
cannot alter a hash (wording, examples) keep the identifier.
