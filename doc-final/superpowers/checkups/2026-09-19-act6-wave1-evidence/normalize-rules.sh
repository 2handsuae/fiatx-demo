#!/bin/bash
# 波一 Task 9 Step 4 归一规则——只归一「两次同代码重铺之间天然会变」的六类值：
#   ① Node 进程号 (node:12345) 与 Nest 日志进程号 [Nest] 12345
#   ② UUID（完整 36 位）
#   ③ 业务单号（前缀 + 日期 + 随机尾：DEP/SWP/WDR/FDO/WQT/SQT/ADJ/RCD/ITR/INC/WDL/WD/ZB/SIG/REC）
#   ④ 人读时间戳（Nest 的 09/19/2026, 8:41:30 PM）与 ISO 串
#   ⑤ recon:demo:break 打印的 wallet= 8 位 hex id（UUID 前 8 位，逐次重铺必变）
# 金额、状态、场景名、案件数、断言行一律不归一——那些是行为。
# 注：macOS sed -E 不支持 \b，单号规则用「前缀+至少6位数字」硬匹配。
sed -E \
  -e 's/\(node:[0-9]+\)/(node:PID)/g' \
  -e 's/\[Nest\] [0-9]+ +- /[Nest] PID  - /g' \
  -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<UUID>/g' \
  -e 's/(DEP|SWP|WDR|FDO|WQT|SQT|ADJ|RCD|ITR|INC|WDL|WD|ZB|SIG|REC)[0-9]{6}[A-Za-z0-9-]*/\1<NO>/g' \
  -e 's/[0-9]{2}\/[0-9]{2}\/[0-9]{4}, [0-9]{1,2}:[0-9]{2}:[0-9]{2} (AM|PM)/<TS>/g' \
  -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z/<ISO>/g' \
  -e 's/wallet=[0-9a-f]{8}(,[0-9a-f]{8})*/wallet=<W>/g' \
  "$1"
