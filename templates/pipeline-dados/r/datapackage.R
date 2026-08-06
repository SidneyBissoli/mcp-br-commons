# =============================================================================
# datapackage.R — geração de descriptor Frictionless Data Package v2 em R
# Padrão de pipeline de dados do portfólio (Fase 0, Entregável 4)
#
# Escrita DIRETA de JSON (jsonlite): o pacote R `frictionless` (rOpenSci)
# implementa só a spec v1 e é centrado em CSV — decidido NÃO usar (06/08/2026).
# Dependências: jsonlite + digest (ambas triviais; nenhuma lib Frictionless).
#
# Uso típico ao fim de um pipeline R → parquet (ver exemplo-build.R):
#   source("r/datapackage.R")
#   recursos <- lapply(arquivos_parquet, dp_resource, dir = dataset_dir)
#   descriptor <- dp_descriptor(name = ..., resources = recursos, ...)
#   dp_write(descriptor, file.path(dataset_dir, "datapackage.json"))
#   dp_write_sha256sums(dataset_dir)
#
# Depois valide com o validador do template:
#   npm run validate -- <dataset_dir>/datapackage.json
# =============================================================================

library(jsonlite)
library(digest)

DP_PROFILE_V2 <- "https://datapackage.org/profiles/2.0/datapackage.json"

DP_MEDIATYPES <- c(
  ndjson  = "application/x-ndjson",
  parquet = "application/vnd.apache.parquet",
  csv     = "text/csv",
  json    = "application/json",
  md      = "text/markdown"
)

#' SHA-256 de um arquivo, prefixado como a spec v2 pede (`sha256:<hex>`)
dp_sha256 <- function(caminho) {
  paste0("sha256:", digest::digest(file = caminho, algo = "sha256"))
}

#' Timestamp canônico do portfólio: RFC 3339, sem milissegundos.
#' Fuso configurável por servidor (default UTC; contrato de proveniência v1.0).
dp_timestamp <- function(quando = Sys.time(), tz = "UTC") {
  if (tz == "UTC") {
    format(quando, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  } else {
    format(quando, "%Y-%m-%dT%H:%M:%S%Ez", tz = tz)
  }
}

#' Monta um resource a partir de um arquivo em disco.
#'
#' @param file  Nome do arquivo RELATIVO à raiz do dataset (vira `path`).
#' @param dir   Raiz do dataset (onde o datapackage.json vai morar).
#' @param name  Identificador do resource (default: stem do arquivo).
#' @param title Título humano (recomendado).
#' @param extra Lista nomeada de propriedades adicionais — custom properties
#'              DEVEM usar namespace (ex.: `"meuns:records" = 1234`).
dp_resource <- function(file, dir, name = NULL, title = NULL, extra = list()) {
  caminho <- file.path(dir, file)
  stopifnot(file.exists(caminho))
  ext <- tolower(tools::file_ext(file))
  if (is.null(name)) name <- tools::file_path_sans_ext(basename(file))

  resource <- list(
    name   = name,
    path   = file,
    format = ext,
    bytes  = file.size(caminho),
    hash   = dp_sha256(caminho)
  )
  if (!is.null(title)) resource$title <- title
  if (!is.na(DP_MEDIATYPES[ext])) resource$mediatype <- unname(DP_MEDIATYPES[ext])
  c(resource, extra)
}

#' Monta o descriptor do data package.
#'
#' Obrigatórios do PORTFÓLIO (a spec só exige resources): name, title, version,
#' licenses, sources — o piso de citação/reprodutibilidade do contrato de
#' proveniência. `id` = DOI da versão, só quando cunhado.
#'
#' @param licenses Lista de listas; cada uma com `name` (id SPDX) OU `path`
#'                 (URL dos termos), + `title` recomendado. Licença do DADO,
#'                 não do código.
#' @param sources  Lista de listas com `title` (+ `path` URL se houver).
#' @param custom   Propriedades fora da spec, SEMPRE com namespace
#'                 (ex.: `"meuns:caveats" = c(...)`).
dp_descriptor <- function(name, title, version, resources,
                          licenses, sources,
                          created = dp_timestamp(),
                          id = NULL, custom = list()) {
  stopifnot(length(resources) >= 1, length(licenses) >= 1, length(sources) >= 1)
  descriptor <- list(`$schema` = DP_PROFILE_V2, name = name)
  if (!is.null(id)) descriptor$id <- id
  descriptor <- c(descriptor, list(
    title     = title,
    version   = version,
    created   = created,
    licenses  = licenses,
    sources   = sources,
    resources = resources
  ), custom)
  descriptor
}

#' Escreve o descriptor como JSON estável (pretty, UTF-8, newline final).
dp_write <- function(descriptor, caminho) {
  json <- jsonlite::toJSON(descriptor, auto_unbox = TRUE, pretty = 2,
                           digits = NA, null = "null")
  writeLines(json, caminho, useBytes = TRUE)
  invisible(caminho)
}

#' SHA256SUMS em formato coreutils, cobrindo TODOS os arquivos do dataset —
#' inclusive o próprio datapackage.json (que não pode conter o próprio hash).
#' Verificação: `sha256sum -c SHA256SUMS`.
dp_write_sha256sums <- function(dir, arquivos = NULL) {
  if (is.null(arquivos)) {
    arquivos <- setdiff(list.files(dir), "SHA256SUMS")
  }
  arquivos <- sort(arquivos)
  linhas <- vapply(arquivos, function(f) {
    hex <- digest::digest(file = file.path(dir, f), algo = "sha256")
    paste0(hex, "  ", f)
  }, character(1))
  writeLines(linhas, file.path(dir, "SHA256SUMS"), useBytes = TRUE)
  invisible(file.path(dir, "SHA256SUMS"))
}
