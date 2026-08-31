#!/usr/bin/env bash
# Node >= 20 的唯一垫片副本。
#
# 为什么需要：本仓库声明层全部指向 Node 20（.nvmrc / Dockerfile ×3 /
# @nestjs/core 的 engines.node = ">= 20"），但从 2026-04-08 起实际跑在 18 上，
# 靠 21 个文件手写 webcrypto 垫片绕过 `globalThis.crypto`（Node ≥19 才有）。
# 此前这段逻辑只在 stack-up.sh 里、且只对服务生效，于是形成
# 「服务跑 20 / 一切验证工具跑 18」的分裂。
#
# 用法：source 本文件后调用 ensure_node20。幂等，可重复 source。
ensure_node20() {
  local major nvm_dir n20 n22 best
  major="$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)"
  if [[ -n "${major}" && "${major}" -ge 20 ]]; then
    return 0
  fi
  nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  n20="$(ls -d "${nvm_dir}/versions/node"/v20.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  n22="$(ls -d "${nvm_dir}/versions/node"/v22.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  best="${n22:-${n20}}"
  if [[ -n "${best}" ]]; then
    export PATH="$(dirname "${best}"):${PATH}"
    echo "[node-env] Node $(node --version) loaded from nvm (仓库要求 >=20)"
  else
    echo "[node-env] ERROR: 找不到 Node >=20。请先 'nvm install 20'。" >&2
    return 1
  fi
}
