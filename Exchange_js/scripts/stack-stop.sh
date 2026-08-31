#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./stack-common.sh
source "${SCRIPT_DIR}/stack-common.sh"

if [[ $# -ne 1 ]]; then
  usage_stack_name
  exit 1
fi

load_stack_config "$1"
assert_stack_is_local
mkdir -p "${RUNTIME_DIR}"

stop_pid_file_process "backend" "${BACKEND_PID_FILE}"
stop_pid_file_process "admin" "${ADMIN_PID_FILE}"
stop_pid_file_process "client" "${CLIENT_PID_FILE}"
stop_pid_file_process "tb" "${TB_PID_FILE}"

stop_listener_if_managed() {
  local name="$1"
  local port="$2"

  local pid
  local command_line
  pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -z "${pid}" ]]; then
    return 0
  fi

  # 本仓库路径含中文（"重做版"）。macOS 默认 locale 下 `ps -o command=` 会把
  # 命令行里的非 ASCII 字节 vis-转义成 `M-iM^GM^M...` 形态，导致下面按 APP_DIR
  # 做子串匹配恒为假。LC_ALL=C.UTF-8 让 ps 原样吐出 UTF-8 字节，不做转义——
  # 别当冗余删掉。
  command_line="$(LC_ALL=C.UTF-8 ps -p "${pid}" -o command= 2>/dev/null || true)"
  if [[ "${command_line}" == *"${APP_DIR}"* ]]; then
    terminate_pid "${name}" "${pid}"
  else
    echo "[${STACK}/${name}] port ${port} owned by non-managed process pid ${pid}, skip"
  fi
}

stop_listener_if_managed "backend" "${BACKEND_PORT}"
stop_listener_if_managed "admin" "${ADMIN_PORT}"
stop_listener_if_managed "client" "${CLIENT_PORT}"

# tb 的判据与另外三个不同：tigerbeetle 的命令行里没有 APP_DIR，有的是数据文件路径。
# 此前 tb 只靠 PID 文件 + pattern 两条路，PID 文件一旦丢失（例如 reset-stack.sh
# 在自己的 shell 里 & 起 TB、脚本退出后 PID 文件被下一轮覆盖），旧 TB 就会活着
# 继续占端口，新 TB 起不来，应用连上的是**带着上一轮全部转账的旧账本**——
# 这正是 2026-08-30「重铺后余额累加、倍数 1→2→3→4」那次假警报的成因。
stop_tb_if_managed() {
  local pid command_line
  pid="$(lsof -tiTCP:"${TB_PORT}" -sTCP:LISTEN | head -n 1 || true)"
  [[ -z "${pid}" ]] && return 0
  # 这里刻意不加 LC_ALL=C.UTF-8（另两处 ps 调用有）：TB_DATA_FILE 恒为
  # /tmp/exchange_js_<sanitize_db_scope 的结果>/0_0.tigerbeetle，而该函数把所有
  # 非字母数字字符换成 _，所以这个路径永远是纯 ASCII，踩不到 macOS ps 的
  # 非 ASCII vis-转义问题。另两处比的是含中文的 APP_DIR，才必须加。
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if [[ "${command_line}" == *"${TB_DATA_FILE}"* ]]; then
    terminate_pid "tb" "${pid}"
  else
    echo "[${STACK}/tb] port ${TB_PORT} owned by non-managed process pid ${pid}, skip"
  fi
}
stop_tb_if_managed

cleanup_orphans_by_pattern "backend-orphan" "${APP_DIR}/dist/main"
cleanup_orphans_by_pattern "admin-orphan" "${APP_DIR}/admin-web/node_modules/.bin/vite --host 0.0.0.0 --port ${ADMIN_PORT}"
cleanup_orphans_by_pattern "client-orphan" "${APP_DIR}/client-web/node_modules/.bin/vite --host 0.0.0.0 --port ${CLIENT_PORT}"
cleanup_orphans_by_pattern "tb-orphan" "tigerbeetle start.*${TB_DATA_FILE}"

echo "[${STACK}] services stopped"
