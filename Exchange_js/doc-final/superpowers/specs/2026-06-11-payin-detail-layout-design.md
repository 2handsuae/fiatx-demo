# Payin 详情页左侧重排 — 设计 spec(含实施要点)

日期:2026-06-11
状态:已确认。范围:`admin-web/src/pages/PayinDetail.tsx` 单文件,无后端变更。

## 诊断

- Chain Details(DetailCard)无条件混排 crypto 字段(txHash/confirmations/from/to address)与 fiat 字段(from/to IBAN/referenceNo/providerTxnId)。
- Tx Hash 浏览器链接硬编码 etherscan,资产是 USDT-TRON → 链接错误。
- Linked Deposit 与 Technical Detail 用手搓 h3,与站内标准容器 DetailCard(20 页在用)不一致。
- Technical Detail 的 raw JSON 与 Status History 时间线 1:1 重复。

## 重排定案

1. Hero 保留。
2. **Chain Details(仅 crypto,`asset.type !== 'FIAT'`)**:Tx Hash(链接按 network:TRON→`https://tronscan.org/#/transaction/<hash>`、ETHEREUM→`https://etherscan.io/tx/<hash>`、其它无链接)、Confirmations、From/To Address、Provider Txn ID(有值才显)。
3. **Bank Transfer(仅 fiat)**:From IBAN、To IBAN、Reference No、Provider Txn ID。
4. Linked Deposit 收进 DetailCard(title 不变)。
5. Status History 保留。
6. Technical Detail 整段删除(连带未用 import)。

## 验收

admin tsc 零错;vite 200;手验 crypto 单(无 IBAN 字段、tronscan 链接)与 fiat 单(无链上字段、Bank Transfer 分区);时间线正常;raw JSON 消失。
