#!/bin/bash
# 用法: bash shots.sh <before|after>   —— 在 worktree 根、self 栈已起、demo:all+break 已采样之后
set -e
PREFIX=$1; E=doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence
# 端口修正（实测，见 task-0-report.md）：.stackports 只存一个裸的 base 端口数字（如
# "3100"），从没有 ADMIN/API 这两个字面量——`grep ADMIN .stackports` 必然空匹配。
# 端口的 KEY=VALUE 形式实际写在 worktree 根 .env（stack.sh up 时由 upsert_env_key 写入）。
ADM=$(grep '^ADMIN_PORT=' .env | cut -d= -f2); API=$(grep '^API_PORT=' .env | cut -d= -f2)
eval "$(node "$E/resolve-shot-targets.mjs" "http://127.0.0.1:$API")"
S="node scripts/demo-shot.js --api http://127.0.0.1:$API"
B="http://localhost:$ADM/admin/reconciliation"
NOTE="Verified against statement and internal records."
# 五页（与波二 p1-p5 同一套）
$S --url "$B/runs"               --out "$E/$PREFIX-p1-runs.png"
$S --url "$B/cases"              --out "$E/$PREFIX-p2-cases.png"
$S --url "$B/cases/$CASE_CORRECT" --wait 2500 --out "$E/$PREFIX-p3-case-detail.png"
$S --url "$B/external-balances"  --out "$E/$PREFIX-p4-external-balances.png"
$S --url "$B/adjustments"        --out "$E/$PREFIX-p5-adjustments.png"
# m1 kind 模式（Correction 直开调账弹窗，零落库）
$S --url "$B/cases/$CASE_CORRECT" --click "Correction" --wait 1500 --out "$E/$PREFIX-m1-adjust-kind.png"
# m2 定性小弹层（Reattribute 打开 picker，零落库）
$S --url "$B/cases/$CASE_REATTR" --click "Reattribute" --wait 1200 --out "$E/$PREFIX-m2-finding-picker.png"
# m3 REATTRIBUTE 锁定视图（记一条定性=落库，故用专属案且排在采样后）
$S --url "$B/cases/$CASE_REATTR" --click "Reattribute" --click "$CAUSE_REATTR" \
   --type "textarea::$NOTE" --click "Continue" --wait 2500 --out "$E/$PREFIX-m3-adjust-reattr-locked.png"
# m4 Hold 弹窗（打开即拍，零落库）
$S --url "$B/cases/$CASE_HOLD" --click "Hold · Investigating" --wait 1200 --out "$E/$PREFIX-m4-hold.png"
# m5 补单弹窗（SUPPLEMENT 定性落库后自动开）
$S --url "$B/cases/$CASE_SUPP" --click "Supplement" --click "$CAUSE_SUPP" \
   --type "textarea::$NOTE" --click "Continue" --wait 2500 --out "$E/$PREFIX-m5-supplement.png"
# m6 核销锁定视图：给 CASE_HOLD 记 Hold·Investigating（m4 的案，此刻真提交）→ ⚡拨钟 → 认损/核销按钮
# 修正1（实测，见报告）：brief 原稿第三个 --click 用 "::0" 想选第一个成因 radio；但
# demo-shot.js 的 "文本::idx" 语义是「取文档序第 idx 个可见、innerText 含该文本的元素」，
# 空文本对任何元素都算「包含」，命中的是整页第一个可见 button/a/[role=button]（多半是导航
# 里的返回按钮），不是弹层内的成因项。改用 resolver 新增的 $CAUSE_HOLD（同 CAUSE_REATTR/
# CAUSE_SUPP 一样按行取真实成因 label 文本）精确点击。
# 修正2（实测）：brief 原稿提交按钮写 "Continue"——那是 Reattribute/Supplement 两族弹层的
# 文案；Hold 弹层（ReconciliationHoldModal）自己的提交按钮实际文案是 "Record hold"。
$S --url "$B/cases/$CASE_HOLD" --click "Hold · Investigating" --click "$CAUSE_HOLD" \
   --type "textarea::$NOTE" --click "Record hold" --wait 2000 --out "$E/$PREFIX-m6a-hold-recorded.png"
# 修正3（实测）：「Fast-forward aging」按钮受 simulation 模式门控（admin-web 的
# useSimulationMode 读 shared_simulation_mode cookie）；demo-shot.js 每次调用都起一个全新
# headless Chrome profile，不带任何历史 cookie/localStorage，默认 simulation=false 时这颗
# 按钮根本不渲染。treasury@fiatx.com（TREASURY_OFFICER）持有 DEMO_CLOCK_WRITE 权限，唯一
# 缺的是这颗 cookie——显式用 --cookie 种上。
$S --url "$B/cases/$CASE_HOLD" --cookie shared_simulation_mode=true --click "Fast-forward aging" --wait 2000 --out "$E/$PREFIX-m6b-aged.png"
# 修正4（实测）：拨钟只是把 SLA 截止挪到过去（页面回显"Deadline moved to the past — next
# scan will breach it."），真正翻牌（slaBreached 置位、nextStep 算出 WRITE_OFF/INCIDENT_
# DEFERRED）要等 case-aging-sweep.service.ts 里 `@Cron('*/1 * * * *')` 的每分钟一次后台扫描
# 跑过一遍。轮询等它翻牌（最多 100 秒），不用固定死等一分钟。
TOKEN=$(curl -s -X POST "http://127.0.0.1:$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"treasury@fiatx.com","password":"123456"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{console.log(JSON.parse(d).access_token)})")
BREACHED=false
for i in $(seq 1 20); do
  BREACHED=$(curl -s "http://127.0.0.1:$API/admin/reconciliation/cases/$CASE_HOLD" -H "Authorization: Bearer $TOKEN" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{console.log(JSON.parse(d).slaBreached)})")
  [ "$BREACHED" = "true" ] && break
  sleep 5
done
echo "aging sweep: slaBreached=$BREACHED (case $CASE_HOLD)"
# 认损（Recognize loss，客户池 UNEXPLAINED_CLIENT_LOSS）与核销（Write off，其余 reasonCode）
# 两种文案互斥，取决于服务端算出的 nextStep.reasonCode——两个按钮试一遍即可，不用先猜。
$S --url "$B/cases/$CASE_HOLD" --click "Recognize loss" --wait 1500 --out "$E/$PREFIX-m6-writeoff-locked.png" \
  || $S --url "$B/cases/$CASE_HOLD" --click "Write off" --wait 1500 --out "$E/$PREFIX-m6-writeoff-locked.png"
echo "shots done: $PREFIX"
