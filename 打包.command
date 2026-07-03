#!/usr/bin/env bash
# 双击我 → 产出一个可发给同事的 Exchange-demo-*.zip
# （在 Finder 里双击即可；产物 zip 会出现在 Exchange_js/ 里）
cd "$(dirname "$0")/Exchange_js" && npm run package:release
echo ""
echo "✅ 打包完成，zip 在 Exchange_js/ 目录里。按回车关闭本窗口。"
read -r
