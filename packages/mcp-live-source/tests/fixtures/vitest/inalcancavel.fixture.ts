// Nada respondeu: runner bloqueado pela origem (ibge, 22/10/2026). Com limite 2, os
// dois primeiros pagam as idas e os seguintes pulam sem ir à rede; o afterAll LANÇA.
import { describe } from "vitest";
import { UpstreamError } from "@sbissoli/mcp-upstream";
import { suiteAoVivo } from "../../../src/vitest.js";

const { aoVivo } = suiteAoVivo({ limiteDoDisjuntor: 2, retentativa: { dormir: async () => {} } });

describe("contrato de exemplo", () => {
  for (const nome of ["a", "b", "c", "d"]) {
    aoVivo(
      nome,
      async () => {
        process.stdout.write(`IDA ${nome}\n`);
        throw new UpstreamError({ url: `https://origem/${nome}`, kind: "timeout", retryable: true, transport: true, attempts: 1 });
      },
      { endpoint: nome },
    );
  }
});
