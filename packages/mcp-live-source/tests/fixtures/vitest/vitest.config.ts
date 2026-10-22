import { defineConfig } from "vitest/config";

// Config do vitest FILHO que tests/vitest-adaptador.test.ts dispara: só as fixtures,
// um arquivo por vez (o pai passa o caminho). Não é lida pelo vitest do pacote.
export default defineConfig({
  test: {
    include: ["**/*.fixture.ts"],
  },
});
