#!/usr/bin/env bash
set -euo pipefail

sanitize_db_scope() {
  local scope="${1:-main}"
  scope="${scope//[^a-zA-Z0-9]/_}"
  if [[ -z "${scope}" ]]; then
    scope="main"
  fi
  echo "${scope}"
}

default_database_url() {
  local scope
  scope="$(sanitize_db_scope "${1:-main}")"
  echo "file:/tmp/exchange_js_${scope}/dev.db"
}

read_database_url() {
  local root_dir="$1"
  local scope="${2:-}"
  local db_url="${DATABASE_URL:-}"

  if [[ -n "${db_url}" ]]; then
    echo "${db_url}"
    return 0
  fi

  if [[ -n "${scope}" ]]; then
    db_url="$(default_database_url "${scope}")"
    echo "${db_url}"
    return 0
  fi

  if [[ -f "${root_dir}/.env" ]]; then
    db_url="$(grep -E '^DATABASE_URL=' "${root_dir}/.env" | tail -n 1 | cut -d'=' -f2- | tr -d '"' || true)"
  fi

  if [[ -z "${db_url}" || "${db_url}" == "file:./dev.db" ]]; then
    db_url="$(default_database_url "main")"
  fi

  echo "${db_url}"
}

resolve_db_file_from_url() {
  local root_dir="$1"
  local db_url="$2"
  local prisma_dir="${root_dir}/prisma"

  if [[ "${db_url}" == file:* ]]; then
    local raw_path="${db_url#file:}"
    if [[ "${raw_path}" = /* ]]; then
      echo "${raw_path}"
    else
      echo "${prisma_dir}/${raw_path#./}"
    fi
    return 0
  fi

  echo "${prisma_dir}/dev.db"
}
