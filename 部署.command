#!/usr/bin/env bash
# 双击：把本机已提交的代码部署到云端演示服务器（spec 2026-09-11）
cd "$(dirname "$0")/Exchange_js" || exit 1
bash scripts/cloud-deploy.sh
rc=$?
echo ""
read -r -p "按回车关闭窗口 " _
exit "$rc"
