# =============================================================================
# exemplo-build.R — etapa "descrever" de um pipeline R → parquet versionado
#
# Exemplo parametrizado no PRIMEIRO ALVO do padrão: sih-br-mcp, cujos 6 parquet
# em data/ hoje não têm metadado algum. Adapte DATASET_DIR/RESOURCES/metadados
# ao seu dataset. A etapa "construir" (download → transformação → parquet) é
# por-projeto — referência viva: sih-br-mcp/scripts/build-aggregations.R.
# =============================================================================

source(file.path(dirname(sys.frame(1)$ofile %||% "."), "datapackage.R"))
`%||%` <- function(a, b) if (is.null(a)) b else a

library(arrow) # só para contar registros dos parquet; a geração não depende dele

DATASET_DIR <- "data" # raiz do release do dataset (parquet + descriptor + docs)
NS <- "sih"           # namespace das custom properties deste dataset

# --- resources: um por arquivo de dado, com contagem de registros ------------
arquivos <- list.files(DATASET_DIR, pattern = "\\.parquet$")
recursos <- lapply(arquivos, function(f) {
  n <- nrow(arrow::read_parquet(file.path(DATASET_DIR, f), col_select = 1))
  dp_resource(
    file = f, dir = DATASET_DIR,
    extra = setNames(list(n), paste0(NS, ":records"))
  )
})

# --- descriptor --------------------------------------------------------------
descriptor <- dp_descriptor(
  name      = "sih-sus-cubos",
  title     = "Cubos agregados do SIH-SUS (internações hospitalares, ICSAP, população)",
  version   = "1.0.0",
  resources = recursos,
  licenses  = list(list(
    # Dado público do DATASUS — sem id SPDX; aponte os termos e descreva.
    path  = "https://datasus.saude.gov.br/transferencia-de-arquivos/",
    title = "Dados públicos do DATASUS/Ministério da Saúde — uso livre com atribuição da fonte."
  )),
  sources   = list(list(
    title = "DATASUS — Sistema de Informações Hospitalares do SUS (SIH/SUS)",
    path  = "https://datasus.saude.gov.br"
  )),
  custom    = setNames(
    list(
      "1.0.0",
      "CHANGELOG-dataset.md",
      "CITATION.cff",
      c("Cubos agregados por residência do paciente (MUNIC_RES), não por local de internação.")
    ),
    paste0(NS, ":", c("schemaVersion", "changelog", "citation", "caveats"))
  )
)

dp_write(descriptor, file.path(DATASET_DIR, "datapackage.json"))
dp_write_sha256sums(DATASET_DIR)

message("Descriptor escrito. Valide com: npm run validate -- ",
        file.path(DATASET_DIR, "datapackage.json"))
