// Noite "só indisponível": uma captura ok, duas com a fonte fora → verde com aviso.
import { describe, expect } from "vitest";
import { UpstreamError } from "@sbissoli/mcp-upstream";
import { suiteAoVivo } from "../../../src/vitest.js";

const { aoVivo } = suiteAoVivo({ retentativa: { dormir: async () => {} } });

describe("contrato de exemplo", () => {
  aoVivo("a responde", async () => {
    expect(1).toBe(1);
  });
  aoVivo(
    "b em 502",
    async () => {
      throw new UpstreamError({ url: "https://origem/b", kind: "http_5xx", status: 502, retryable: true, transport: false, attempts: 1 });
    },
    { endpoint: "b" },
  );
  aoVivo(
    "c em timeout",
    async () => {
      throw new UpstreamError({ url: "https://origem/c", kind: "timeout", retryable: true, transport: true, attempts: 1 });
    },
    { endpoint: "c" },
  );
});
