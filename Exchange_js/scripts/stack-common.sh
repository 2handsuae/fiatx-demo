#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./db-env.sh
source "${SCRIPT_DIR}/db-env.sh"
CURRENT_WT_DIR="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${CURRENT_WT_DIR}" ]]; then
  CURRENT_WT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

GIT_COMMON_DIR="$(
  git -C "${SCRIPT_DIR}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null ||
    echo "${CURRENT_WT_DIR}/.git"
)"
ROOT_DIR="$(cd "${GIT_COMMON_DIR}/.." && pwd)"

STACK=""
WT_DIR=""
APP_DIR=""
BACKEND_PORT=""
ADMIN_PORT=""
CLIENT_PORT=""
BACKEND_URL=""
ADMIN_URL=""
CLIENT_URL=""
BRANCH_RULE=""

TB_PORT=""
TB_DATA_FILE=""
TB_ADDRESS=""

RUNTIME_DIR=""
BACKEND_LOG=""
ADMIN_LOG=""
CLIENT_LOG=""
TB_LOG=""
BACKEND_PID_FILE=""
ADMIN_PID_FILE=""
CLIENT_PID_FILE=""
TB_PID_FILE=""

usage_stack_name() {
  echo "Usage: $0 <main|self>" >&2
}

# Auto-allocate a stable 4-port block for a per-worktree ("self") stack.
# The chosen base port is persisted in <wt_dir>/.stackports (gitignored) so the
# assignment stays stable across restarts. We skip ports reserved by main and by
# sibling worktrees, then probe for a block with no live listener. Written for
# bash 3.2 (macOS default) — no associative arrays.
allocate_worktree_ports() {
  local wt_dir="$1"
  local pf="${wt_dir}/.stackports"
  local base off busy f b

  if [[ -f "${pf}" ]]; then
    base="$(head -n 1 "${pf}" 2>/dev/null | tr -dc '0-9')"
    if [[ -n "${base}" ]]; then
      echo "${base}"
      return 0
    fi
  fi

  local reserved=" 3000 "
  for f in "${ROOT_DIR}"/.claude/worktrees/*/.stackports; do
    [[ -f "${f}" ]] || continue
    b="$(head -n 1 "${f}" 2>/dev/null | tr -dc '0-9')"
    [[ -n "${b}" ]] && reserved="${reserved}${b} "
  done

  for (( base=3100; base<=3990; base+=10 )); do
    case "${reserved}" in *" ${base} "*) continue ;; esac
    busy=0
    for off in 0 1 2 3; do
      if lsof -nP -iTCP:"$(( base + off ))" -sTCP:LISTEN >/dev/null 2>&1; then
        busy=1
        break
      fi
    done
    [[ "${busy}" -eq 1 ]] && continue
    mkdir -p "${wt_dir}"
    echo "${base}" >"${pf}"
    echo "${base}"
    return 0
  done

  echo "[stack] ERROR: no free port block in 3100-3990 for worktree ${wt_dir}" >&2
  return 1
}

load_stack_config() {
  local stack="$1"
  local current_branch
  current_branch="$(git -C "${CURRENT_WT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "*")"
  case "$stack" in
    main)
      STACK="main"
      # 这里只解析 main 栈的配置（路径/端口），不判断"是否允许动它"——那是
      # assert_stack_is_local() 的职责，由会动运行态的调用方在 load_stack_config
      # 之后显式调用。只读调用方（如 runtime-diagnose.sh）不调用它，因此可以从
      # 任意 worktree 解析 main 的配置，用于只读查询 main 栈的状态。
      WT_DIR="${ROOT_DIR}"
      APP_DIR="${ROOT_DIR}/Exchange_js"
      BRANCH_RULE="main"
      BACKEND_PORT="3000"
      ADMIN_PORT="3001"
      CLIENT_PORT="3002"
      TB_PORT="3003"
      TB_DATA_FILE="/tmp/exchange_js_main/0_0.tigerbeetle"
      ;;
    self)
      # Per-worktree auto stack. Each worktree under .claude/worktrees/ gets its
      # own port block + its own DB/TB scope so many sessions run in parallel
      # without colliding. Run this from inside the worktree you want to boot.
      if [[ "${CURRENT_WT_DIR}" == "${ROOT_DIR}" ]]; then
        # 'self' from the main worktree is just the canonical main stack.
        load_stack_config main
        return $?
      fi
      local wt_name base
      wt_name="$(sanitize_db_scope "$(basename "${CURRENT_WT_DIR}")")"
      STACK="wt_${wt_name}"
      WT_DIR="${CURRENT_WT_DIR}"
      APP_DIR="${WT_DIR}/Exchange_js"
      BRANCH_RULE="*"
      base="$(allocate_worktree_ports "${WT_DIR}")" || return 1
      BACKEND_PORT="${base}"
      ADMIN_PORT="$(( base + 1 ))"
      CLIENT_PORT="$(( base + 2 ))"
      TB_PORT="$(( base + 3 ))"
      TB_DATA_FILE="/tmp/exchange_js_${STACK}/0_0.tigerbeetle"
      ;;
    *)
      usage_stack_name
      return 1
      ;;
  esac

  BACKEND_URL="http://localhost:${BACKEND_PORT}"
  ADMIN_URL="http://localhost:${ADMIN_PORT}"
  CLIENT_URL="http://localhost:${CLIENT_PORT}"
  TB_ADDRESS="127.0.0.1:${TB_PORT}"

  RUNTIME_DIR="/tmp/exchange_js_runtime_${STACK}"
  BACKEND_LOG="${RUNTIME_DIR}/backend.log"
  ADMIN_LOG="${RUNTIME_DIR}/admin.log"
  CLIENT_LOG="${RUNTIME_DIR}/client.log"
  TB_LOG="${RUNTIME_DIR}/tb.log"
  BACKEND_PID_FILE="${RUNTIME_DIR}/backend.pid"
  ADMIN_PID_FILE="${RUNTIME_DIR}/admin.pid"
  CLIENT_PID_FILE="${RUNTIME_DIR}/client.pid"
  TB_PID_FILE="${RUNTIME_DIR}/tb.pid"
}

# 会动目标栈"运行态"（起停进程、清库、重铺 TB）的调用方，必须在 load_stack_config
# 之后显式调用本函数。main 栈的运行态（RUNTIME_DIR / PID 文件 / DB / TB）是全局
# 唯一的，只按栈名分、不按工作树分。从 worktree 操作 main 栈，会让 stack-up.sh
# 里的 stack-stop 调用读到 /tmp/exchange_js_runtime_main/*.pid 并杀掉主工作树
# 正在跑的服务。CLAUDE.md §10 已有铁律"绝不在主工作树切分支跑服务"，这里补上
# 反向的一半。只读调用方（如 runtime-diagnose.sh）以及显式指定目标栈的正规
# 入口（on-stack.sh）不调用本函数——它们不动运行态，从 worktree 查 main 栈的
# 状态是正当用法。
assert_stack_is_local() {
  if [[ "${STACK}" == "main" && "${CURRENT_WT_DIR}" != "${ROOT_DIR}" ]]; then
    echo "[stack] 拒绝：不能从 worktree 操作 main 栈。" >&2
    echo "[stack]   当前工作树: ${CURRENT_WT_DIR}" >&2
    echo "[stack]   主工作树:   ${ROOT_DIR}" >&2
    echo "[stack]   要起本树的栈用 'self'；要动 main 栈请到主工作树执行。" >&2
    return 1
  fi
}

require_commands() {
  local missing=0
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "Missing required command: $cmd" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

assert_stack_paths() {
  if [[ ! -d "${WT_DIR}" ]]; then
    echo "Missing worktree: ${WT_DIR}" >&2
    return 1
  fi

  if [[ ! -d "${APP_DIR}" ]]; then
    echo "Missing app directory: ${APP_DIR}" >&2
    return 1
  fi

  if [[ ! -f "${APP_DIR}/package.json" ]]; then
    echo "Missing backend package.json: ${APP_DIR}/package.json" >&2
    return 1
  fi

  if [[ ! -f "${APP_DIR}/admin-web/package.json" ]]; then
    echo "Missing admin package.json: ${APP_DIR}/admin-web/package.json" >&2
    return 1
  fi

  if [[ ! -f "${APP_DIR}/client-web/package.json" ]]; then
    echo "Missing client package.json: ${APP_DIR}/client-web/package.json" >&2
    return 1
  fi
}

stack_branch() {
  git -C "${WT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(unknown)"
}

assert_branch_rule() {
  local branch
  branch="$(stack_branch)"

  case "${branch}" in
    ${BRANCH_RULE})
      return 0
      ;;
    *)
      echo "[${STACK}] expected branch rule ${BRANCH_RULE}, got: ${branch}" >&2
      return 1
      ;;
  esac
}

ensure_dependencies() {
  local name="$1"
  local dir="$2"

  if [[ -d "${dir}/node_modules" ]]; then
    return 0
  fi

  echo "[${STACK}/${name}] node_modules missing, installing dependencies..."
  if [[ -f "${dir}/package-lock.json" ]]; then
    (
      cd "${dir}"
      npm ci
    )
  else
    (
      cd "${dir}"
      npm install
    )
  fi
}

# Upsert KEY=VALUE into an env file: replace the line in place if the key exists,
# else append. Creates the file if missing. BSD/GNU-portable (awk temp-file, no
# `sed -i`). VALUE is written literally. Only clean values (ports/URLs/paths).
upsert_env_key() {
  local file="$1" key="$2" value="$3"
  touch "${file}"
  if grep -qE "^${key}=" "${file}"; then
    awk -v k="${key}" -v line="${key}=${value}" \
      '$0 ~ "^"k"=" {print line; next} {print}' "${file}" >"${file}.tmp" \
      && mv "${file}.tmp" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}

ensure_env_files() {
  local backend_env="${APP_DIR}/.env"
  local admin_env="${APP_DIR}/admin-web/.env"
  local client_env="${APP_DIR}/client-web/.env"
  local default_db_url
  default_db_url="$(default_database_url "${STACK}")"

  # 权威重写:每次 up 把 stack 管理键改成 load_stack_config 为「本栈」分到的端口/URL。
  # 其它键(密钥、MFA_ISSUER、SUMSUB_MOCK_MODE …)一律保留。自愈脏/陈旧 .env,
  # 令 worktree 前后端始终指向自己的栈(消除 vite 读 .env vs 注入 env 的优先级歧义)。
  upsert_env_key "${backend_env}" "API_PORT"     "${BACKEND_PORT}"
  upsert_env_key "${backend_env}" "ADMIN_PORT"   "${ADMIN_PORT}"
  upsert_env_key "${backend_env}" "CLIENT_PORT"  "${CLIENT_PORT}"
  upsert_env_key "${backend_env}" "API_URL"      "${BACKEND_URL}"
  upsert_env_key "${backend_env}" "ADMIN_URL"    "${ADMIN_URL}"
  upsert_env_key "${backend_env}" "CLIENT_URL"   "${CLIENT_URL}"
  upsert_env_key "${backend_env}" "DATABASE_URL" "\"${default_db_url}\""
  upsert_env_key "${backend_env}" "TB_ADDRESS"   "${TB_ADDRESS}"
  # 演示开关:仅在缺失时补默认,不覆盖操作者已设的值。
  grep -qE "^GOVERNANCE_DEMO_ENABLED=" "${backend_env}" \
    || printf 'GOVERNANCE_DEMO_ENABLED=true\n' >>"${backend_env}"
  # 同上。缺它的后果不显眼但很致命:充值/提现的 demo 裁决 controller 是**条件注册**的
  # (见 deposit-sumsub.module.ts 的条件 controllers 数组——生产下这些路由压根不存在,
  # 不是靠 guard 拦),SUMSUB_MOCK_MODE 不为 true 时整条演示链路的路由返回 404,
  # 且 SumsubClient 会因为没有 APP_TOKEN/SECRET_KEY 抛错。
  # 上面第 263 行的注释一直把它列为"要保留的键",却从没有任何地方创建过它,
  # 于是每个新 worktree 的栈都不在演示模式下(2026-08-05 验收时发现)。
  grep -qE "^SUMSUB_MOCK_MODE=" "${backend_env}" \
    || printf 'SUMSUB_MOCK_MODE=true\n' >>"${backend_env}"

  upsert_env_key "${admin_env}"  "VITE_API_URL" "${BACKEND_URL}"
  upsert_env_key "${client_env}" "VITE_API_URL" "${BACKEND_URL}"

  echo "[${STACK}] env reconciled: API_PORT=${BACKEND_PORT} TB=${TB_ADDRESS} VITE_API_URL=${BACKEND_URL}"
}

resolve_db_file() {
  local db_url
  db_url="$(read_database_url "${APP_DIR}" "${STACK}")"
  resolve_db_file_from_url "${APP_DIR}" "${db_url}"
}

db_needs_seed_data() {
  local db_file="$1"
  local required_tables=("users" "roles" "permissions")

  if [[ ! -f "${db_file}" ]]; then
    echo "[${STACK}] seed check: database file is missing (${db_file})"
    return 0
  fi

  for table in "${required_tables[@]}"; do
    local table_exists
    table_exists="$(
      sqlite3 "${db_file}" \
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';" \
        2>/dev/null || echo "0"
    )"
    if [[ "${table_exists}" != "1" ]]; then
      echo "[${STACK}] seed check: required table '${table}' is missing"
      return 0
    fi

    local row_count
    row_count="$(sqlite3 "${db_file}" "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo "0")"
    if ! [[ "${row_count}" =~ ^[0-9]+$ ]] || [[ "${row_count}" -eq 0 ]]; then
      echo "[${STACK}] seed check: table '${table}' has no baseline rows"
      return 0
    fi
  done

  return 1
}

bootstrap_database_if_needed() {
  local db_file
  local db_url
  db_file="$(resolve_db_file)"
  db_url="$(read_database_url "${APP_DIR}" "${STACK}")"

  mkdir -p "$(dirname "${db_file}")"
  echo "[${STACK}] applying pending Prisma migrations to ${db_file}"
  (
    cd "${APP_DIR}"
    DATABASE_URL="${db_url}" bash scripts/apply-local-migrations.sh "${APP_DIR}" "${STACK}"
  )

  if db_needs_seed_data "${db_file}"; then
    echo "[${STACK}] missing base IAM baseline, running db:base:sync..."
    (
      cd "${APP_DIR}"
      DATABASE_URL="${db_url}" npm run db:base:sync
    )

    if db_needs_seed_data "${db_file}"; then
      echo "[${STACK}] FATAL: db:base:sync failed, base IAM baseline is still missing." >&2
      exit 1
    fi

    echo "[${STACK}] base IAM baseline sync completed."
  else
    echo "[${STACK}] base IAM baseline verified: ${db_file}"
  fi
}

# 端口被占时：占用者是本栈自己的残留（命令行含 APP_DIR）→ 杀掉继续；
# 是别人的 → 打印占用者并返回非零（调用方在 set -e 下会中止，这是对的：
# 跨栈误杀会毁掉并行会话的验收库）。
#
# 此前无条件返回非零，于是 admin/client 端口被上次会话遗留的 vite 占着时，
# 整个 up 中止、后续服务全不起，且看着不像出错（PRODUCTION-NOTES:382，
# 登记 50 天，两个实施者各撞一次）。
ensure_port_free() {
  local port="$1"
  local name="$2"
  # marker：判断"占用者是不是本栈自己"的字符串锚点。backend/admin/client 三个
  # 服务的命令行里都带 APP_DIR（默认值），但 tigerbeetle 的命令行里没有
  # APP_DIR、只有数据文件路径（与 stop_tb_if_managed 的判据同源），所以
  # tb 调用方要显式传第三个参数覆盖默认值,见 stack-up.sh 里 tb 的调用点。
  local marker="${3:-${APP_DIR}}"

  if ! lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi

  local pid command_line
  pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  # 本仓库路径含中文（"重做版"）。macOS 默认 locale 下 `ps -o command=` 会把
  # 命令行里的非 ASCII 字节 vis-转义成 `M-iM^GM^M...` 形态，导致下面按 marker
  # （APP_DIR/TB_DATA_FILE）做子串匹配恒为假。LC_ALL=C.UTF-8 让 ps 原样吐出
  # UTF-8 字节，不做转义——别当冗余删掉。
  command_line="$(LC_ALL=C.UTF-8 ps -p "${pid}" -o command= 2>/dev/null || true)"

  if [[ -n "${command_line}" && "${command_line}" == *"${marker}"* ]]; then
    echo "[${STACK}/${name}] port ${port} 被本栈残留占用 (pid ${pid})，清理后继续"
    terminate_pid "${name}" "${pid}"
    for _ in {1..20}; do
      lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 || return 0
      sleep 0.2
    done
    echo "[${STACK}/${name}] port ${port} 清理后仍被占用，放弃" >&2
    return 1
  fi

  echo "[${STACK}/${name}] port ${port} 被非本栈进程占用 (pid ${pid})，拒绝启动" >&2
  [[ -n "${command_line}" ]] && echo "[${STACK}/${name}] command: ${command_line}" >&2
  echo "[${STACK}/${name}] 本栈 APP_DIR=${APP_DIR}；跨栈杀进程会毁掉并行会话的库，故不自动清理" >&2
  return 1
}

capture_listener_pid() {
  local name="$1"
  local port="$2"
  local pid_file="$3"

  for _ in {1..120}; do
    local pid
    pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
    if [[ -n "${pid}" ]]; then
      echo "${pid}" >"${pid_file}"
      echo "[${STACK}/${name}] listening on ${port} (pid ${pid})"
      return 0
    fi
    sleep 0.5
  done

  echo "[${STACK}/${name}] failed to detect listener on ${port}" >&2
  return 1
}

terminate_pid() {
  local name="$1"
  local pid="$2"

  if [[ -z "${pid}" ]]; then
    return 0
  fi

  if ! kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  echo "[${STACK}/${name}] stopping pid ${pid}"
  kill "${pid}" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  if kill -0 "${pid}" 2>/dev/null; then
    kill -9 "${pid}" 2>/dev/null || true
  fi
}

stop_pid_file_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "${pid_file}" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  terminate_pid "${name}" "${pid}"
  rm -f "${pid_file}"
}

cleanup_orphans_by_pattern() {
  local name="$1"
  local pattern="$2"
  local pids

  pids="$(pgrep -f "${pattern}" 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    terminate_pid "${name}" "${pid}"
  done <<<"${pids}"
}

service_state() {
  local port="$1"
  local pid_file="$2"

  local listen_pid
  listen_pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -n "${listen_pid}" ]]; then
    echo "up:${listen_pid}"
    return 0
  fi

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "booting:${pid}"
      return 0
    fi
  fi

  echo "down"
}
