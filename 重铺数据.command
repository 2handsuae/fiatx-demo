#!/usr/bin/env bash
# 双击：云端演示服务器重铺一套全新数据（spec 2026-09-11）
cd "$(dirname "$0")/Exchange_js" || exit 1
bash scripts/cloud-reset.sh
rc=$?
echo ""
read -r -p "按回车关闭窗口 " _
exit "$rc"
