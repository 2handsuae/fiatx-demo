# V1 审计底座 — 深度调研留底（Governance/Audit Foundation Research）

Date: 2026-07-04 ｜ Status: 研究定稿（provenance 留底，用于重排 roadmap V1）
Method: deep-research harness，104 agent 五路搜索 → 抓 VARA TIR/CRM/Company Rulebook 原文 + NIST SP 800-53/800-57 → 三票对抗验证 → 综合；10 条 findings（多数 high、个别 medium，见各条 vote/confidence），22 源。
Scope: **平台必须自建代码的治理软件工作流**——访问控制/认证、密钥治理、审计日志与留存、变更管理、admin/凭证生命周期、特权访问治理。**不含**纯组织/政策类（董事会/fit-and-proper/外包供应商治理），不重复 V2-V9。
对标基准：V1 现有 10 MVP + 8 ADVANCED 工作流清单（见 roadmap V1）。

---

## 核心结论

治理骨架（审批引擎/审计写入/RBAC/admin 生命周期）方向正确，但**优先级分层有系统性错位**：多项归入 ADVANCED 的工作流其实是牌照级 P0。三大错位：① 定期权限复审 ② 审计日志 8 年留存归档 ③ 密钥完整生命周期治理。另有一批 VARA/NIST 明确要求但现有清单缺失：审计 WORM/tamper-evidence + 实时告警、变更前强制安全测试门、会话即时撤销、PAM、SoD 扩容、admin 生命周期通知补实。骨架（maker-checker/审批策略/角色 CRUD）够用不用重做。

## 一、优先级错位（现在 ADVANCED → 应 P0）

| 项 | 依据 | vote |
|---|---|---|
| **审计日志 8 年留存与归档** | CRM Rule I.F.2「no less than eight (8) years；涉国安无限期」+ I.F.1 全交易审计轨迹。8 年强制留存使归档能力成合规必备而非可选（VARA 8 年严于联邦 AML 5 年）| I.F.2 3-0 |
| **定期权限复审/复认** | Schedule 1 RC2 Std 8「regular access reviews and immediate revocation」+ §D.2.d.ii「quarterly internal audits」+ NIST AC-2/AC-6(7) | Std8 3-0 / D.2.d.ii 2-1 |
| **API Key/密钥定期轮换** | NIST SP 800-57 crypto period（对称 DEK ≤2 年、签名密钥 1-3 年）使定期轮换为递归必备控制 | 1-1（medium）|

## 二、缺失的必须工作流（现有清单没有）

### 密钥完整生命周期治理 `§D.2.c/d 3-0`
- VARA TIR §D：对密钥严格访问管理 + 保留「audit log detailing each change of access to keys」（append-only）；离职密钥持有人（含多签）须做再密钥评估；immediately revoke 签名人访问且撤销者不得再接触备份助记词；密钥存储拆分使任一在线/物理位置不足以单独动资产。
- **⚠️ HexTrust 边界（关键界定）**：§D 义务约束执行托管的一方；**托管签名密钥外包 HexTrust → HexTrust 承担签名/托管密钥治理，平台保留监督/披露义务**。平台**自建**密钥范围窄于"完整链上密钥生命周期"——实为 **API Key + 加密密钥(DEK/KEK) + admin 凭证**，这些仍需生命周期治理（NIST SP 800-57 crypto period）。**勿去实现链上签名密钥托管**。

### 审计日志不可篡改（WORM/tamper-evidence）+ 实时安全告警 `3-0`
- Schedule 1 RC2 Std 13：日志捕获所有安全相关事件、「store logs securely with tamper-evidence」、留存 ≥1 年、含全部钱包与密钥操作、「implement real-time alerting for security events」。
- 对 V1：现有"append-only 写入"≠ WORM/tamper-evidence，需哈希链/完整性验证；实时安全告警缺失（现通知本体是 stub）。注：1 年为技术层下限，与 I.F.2 的 8 年记录留存并存，取更严。

### 生产变更前强制安全测试门 `2-1`
- Schedule 1 RC2 Std 11：安全测试「in all events prior to any update to a production system」+ 年度第三方渗透测试 + 季度漏洞评估 + 持续自动化扫描 + 正式漏洞整改追踪。
- caveat：Schedule 1 为 Guidance（'expected to'），黑字 Rule I.E.1 措辞较软（'at least annual... and prior to the introduction of any new systems'），quarterly 属监管预期非黑字。变更管理工作流本身（触发→测试门→审批发布→审计）是平台应自建的治理软件工作流。

### 会话即时撤销/终止 `NIST AC-12 3-0；VARA read-across 2-1（medium）`
- VARA §D.2.d 对密钥签名人「immediately revoke access」（黑字 must）；NIST AC-12 要求按组织定义条件/触发事件自动终止会话（触发含「targeted responses to certain types of incidents」，即事件驱动非仅空闲超时）。
- 对 V1：现有"停用仅下次 JWT 校验生效"**不满足即时性**——应做撤销列表/短 TTL+即时吊销，至少对特权账户 P0。
- caveat：VARA 'immediately' 字面约束密钥签名人（托管外包 HexTrust），read-across 到自有 admin JWT 撤销是合理但非字面强制解读（故 medium）；NIST AC-12 提供确定标准基础。

### 特权访问管理 PAM / 最小权限强制 `AC-6(5)/(7) 3-0`
- NIST AC-6(5)：特权账户限定组织定义的人员/角色；AC-6(7)：定期复审特权。
- 对 V1：现有 RBAC/角色 CRUD 覆盖角色定义，缺"特权账户白名单强制 + 特权操作审计 + 定期特权复审 + Break-Glass 紧急特权"的 PAM 闭环（Break-Glass 现在 ADVANCED）。业界实践基础（非 NIST 软件硬强制）。

### SoD 互斥矩阵扩容 `§B.1/B.2 3-0`
- Company Rulebook §B.1：董事会将政策制定/监督/咨询/内审与运营职责有效分离；§B.2：**sales、dealing、accounting、settlement、safekeeping 相互分离**。
- **关键界定**：VARA SoD 是**组织/职能层分离义务，不是逐笔 four-eyes/maker-checker**——maker-checker 是平台自选实现手段（骨架正确够用）。但 SoD 冲突矩阵不应止于现有 3 对 admin 生命周期，宜纳入 VARA 枚举的 5 类运营职责对。

### admin 生命周期自动审计 + 通知 `AC-2(4) 3-0`
- NIST AC-2(4)：系统自动审计账户 create/modify/enable/disable/remove + 通知指定人员。
- 对 V1：现有审批+审计写入覆盖"自动审计"半边；"通知指定人员"半边因**通知本体是 stub 未落地**（呼应 V1 体检发现）——应补实通知（尤其 disable/delete/特权变更）。

## 三、优先级重排建议

- **提级 P0**：审计日志 8 年归档、定期权限复审、审计 WORM+实时告警、会话即时撤销、SoD 扩容、admin 生命周期通知补实、密钥（API/加密/凭证）定期+紧急轮换。
- **P1**：PAM 特权治理闭环、变更前安全测试门（依赖 CI/CD）、渗透/漏洞治理记录。
- **保持**：现有 10 MVP 骨架够用，不重做。

## 置信度提醒

黑字 shall（高置信）：8 年留存、SoD 枚举、WORM+告警、密钥访问审计、AC 系列。指导语气/read-across（中高置信）：定期复审的全平台 RBAC 强制性靠 Schedule 1 'expected to' + NIST 基线（对密钥/凭证访问是硬的，对全平台 RBAC 略软）；会话即时撤销的 VARA read-across；密钥轮换 crypto period（1-1 split，方向靠 800-57 强制性支撑）。

## 主要源

VARA: TIR Rulebook（§D 密钥钱包、Part I 技术治理、Section K/H）、Schedule 1（RC2 Std 8/11/13）、CRM Rulebook（I.F 留存）、Company Rulebook（§B SoD）。NIST: SP 800-53 AC-2/AC-2(4)/AC-6(5)/AC-6(7)/AC-12；SP 800-57 Part 1（crypto period）。
