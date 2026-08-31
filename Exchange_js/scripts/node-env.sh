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
    # 刻意与被它取代的 stack-up.sh:10-24 不等价：原实现在这里是 WARNING + 继续，
    # 于是服务照样在 Node 18 上起来、然后以别的形态出错（Vite 7 需要 >=20）。
    # 本轮的整个主张就是「失败要响，不要静默地跑在错的版本上」，故改成硬失败。
    # 2026-08-31 Task 3 评审提出该分歧，控制方判定保留——勿改回 WARNING。
    echo "[node-env] ERROR: 找不到 Node >=20。请先 'nvm install 20'。" >&2
    return 1
  fi
}
