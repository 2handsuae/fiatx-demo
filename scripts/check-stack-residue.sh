#!/usr/bin/env bash
# 运行时状态巡检：孤儿进程 + 残留目录。**只报告，不删。**
#
# 为什么挂在 stack.sh up 上而不是做成独立命令：本仓库已经证伪过一次
# "独立自检命令"——scripts/runtime-diagnose.sh 写得没问题，
# 而 PRODUCTION-NOTES:394 自己写着"它不在 stack.sh 的路径上，没人会主动跑"。
# 检查必须挂在本来就必跑的命令上。
#
# 为什么不自动删：残留目录可到 1.1 G 且删了不可逆；跨栈误删会毁掉
# 并行会话正在验收的库。判断该不该删是人的事。
#
# 退出码恒为 0 —— 这是巡检，不是闸门，不该阻断起栈。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_COMMON_DIR="$(git -C "${SCRIPT_DIR}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -z "${GIT_COMMON_DIR}" ]]; then
  echo "[residue] 不在 git 仓库内，跳过巡检"
  exit 0
fi
ROOT_DIR="$(cd "${GIT_COMMON_DIR}/.." && pwd)"

# ── 活栈端口块：main 的 3000 + 每个存在的 worktree 的 .stackports ──
live_bases=" 3000 "
for f in "${ROOT_DIR}"/.claude/worktrees/*/.stackports; do
  [[ -f "${f}" ]] || continue
  b="$(head -n 1 "${f}" 2>/dev/null | tr -dc '0-9')"
  [[ -n "${b}" ]] && live_bases="${live_bases}${b} "
done

is_live_port() {
  local port="$1" base
  for base in ${live_bases}; do
    if [[ "${port}" -ge "${base}" && "${port}" -le $(( base + 3 )) ]]; then
      return 0
    fi
  done
  return 1
}

orphan_procs=0
while IFS= read -r pid; do
  [[ -z "${pid}" ]] && continue
  # -a: AND 组合 -p 与 -i/-s（lsof 默认 OR 组合选择条件；不加 -a 时 -p 形同虚设，
  # 会把系统里第一个匹配 -iTCP -sTCP:LISTEN 的无关进程当成该 pid 的端口，实测触发）。
  port="$(lsof -nP -a -p "${pid}" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {sub(/.*:/,"",$9); print $9; exit}')"
  [[ -z "${port}" ]] && continue
  if ! is_live_port "${port}"; then
    if [[ "${orphan_procs}" -eq 0 ]]; then
      echo ""
      echo "[residue] ⚠️ 孤儿进程（监听端口不属于任何活着的栈）："
    fi
    echo "[residue]   pid ${pid} port ${port} — $(ps -p "${pid}" -o command= 2>/dev/null | cut -c1-96)"
    orphan_procs=$(( orphan_procs + 1 ))
  fi
done < <(pgrep -f 'tigerbeetle start|dist/main|node_modules/.bin/vite' 2>/dev/null || true)

orphan_dirs=0
for d in /tmp/exchange_js_wt_* /tmp/exchange_js_runtime_wt_*; do
  [[ -d "${d}" ]] || continue
  name="$(basename "${d}" | sed 's/^exchange_js_//; s/^runtime_//; s/^wt_//' | tr '_' '-')"
  [[ -d "${ROOT_DIR}/.claude/worktrees/${name}" ]] && continue
  if [[ "${orphan_dirs}" -eq 0 ]]; then
    echo ""
    echo "[residue] ⚠️ 残留目录（对应工作树已不存在）："
  fi
  echo "[residue]   ${d}  ($(du -sh "${d}" 2>/dev/null | cut -f1))"
  orphan_dirs=$(( orphan_dirs + 1 ))
done

if [[ "${orphan_procs}" -gt 0 || "${orphan_dirs}" -gt 0 ]]; then
  echo ""
  echo "[residue] 共 ${orphan_procs} 个孤儿进程 / ${orphan_dirs} 个残留目录。"
  echo "[residue] 只报告不自动清理——确认无人在用后手工处理："
  echo "[residue]   kill <pid>        # 孤儿进程"
  echo "[residue]   rm -rf <目录>      # 残留目录（不可逆，先看清楚名字）"
  echo ""
fi

exit 0
