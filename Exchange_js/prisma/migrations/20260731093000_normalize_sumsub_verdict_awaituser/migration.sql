-- 规范化 sumsubVerdict 的 awaitUser 拼写。
--
-- 背景:上一支迁移(20260730212024_deposit_single_sumsub_txn)把旧的 financeStatus
-- 四值反查回填成 sumsubVerdict 时,'AWAITING_USER' 被写成了 'awaitingUser';而运行时
-- 真正落库的裁决原值是 'awaitUser'(见 sumsub-txn.types.ts 的 KytVerdict 联合类型与
-- deposit-kyt-verdict.handler.ts 的 VERDICT_BY_TYPE)。
--
-- 后果:'awaitingUser' 是一个此后永不再出现的值,且详情页 L2 的着色表
-- (admin-web/src/utils/depositActionMap.ts 的 LAYER_PENDING)只认 AWAITUSER /
-- AWAITING_USER,认不出 AWAITINGUSER —— 这类单会落回默认灰,与「无状态」视觉无区分,
-- 而 awaitUser 恰是最需要 officer 注意的态之一。
--
-- 已应用的迁移不可编辑(会触发 stack.sh 的 checksum 守卫),故以本支新迁移纠正。
-- 幂等:无匹配行时是 no-op。
UPDATE "deposit_transactions"
SET "sumsubVerdict" = 'awaitUser'
WHERE "sumsubVerdict" = 'awaitingUser';
