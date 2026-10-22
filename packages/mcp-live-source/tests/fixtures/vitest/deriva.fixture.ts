// Deriva medida: a origem respondeu e a asserção do teste falhou → vermelho rotulado.
import { describe, expect } from "vitest";
import { suiteAoVivo } from "../../../src/vitest.js";

const { aoVivo } = suiteAoVivo({ retentativa: { dormir: async () => {} } });

describe("contrato de exemplo", () => {
  aoVivo("a responde", async () => {
    expect(1).toBe(1);
  });
  aoVivo(
    "d respondeu outra coisa",
    async () => {
      expect(400, "idade do último ponto").toBeLessThanOrEqual(160);
    },
    { endpoint: "d" },
  );
});
