# doc-final — 读法地图

本目录是**唯一**的项目文档根，禁止在别处另立文档目录。三层关系：**`prd/` = 应然（业主写）｜ `modules/` = 实然（agent 维护）｜ `test-cases/` = 验收**。三者不一致 = 待办，登记 BACKLOG，不改 PRD 迁就代码。

| 位置 | 是什么 | 谁维护 | 什么时候读 |
|---|---|---|---|
| `modules/` | 各模块业务说明 + 关键技术节点；首读 `overview.md` | agent | 每次任务 |
| `prd/` | 需求原文（重新撰写中，篇目另定）（待建） | 业主 | 改对应模块前 |
| `demo/` | 演示剧本（七幕）/ 数据字典 / 模拟说明 | 主线业主定，其余 agent | 演示前；改页面/种子时同步 |
| `decisions.md` | 业务决策记录，只追加 | 业主 | **动任何设计前** |
| `rules/` | 写法约束 + `review-rubric.md` 评审表 | 业主 | 写码 / 评审时 |
| `test-cases/` | 验收用例（按 PRD 应然写，不按代码现值写） | agent | 验收 / 写用例时 |
| `superpowers/{specs,plans}/` | **活层**：进行中任务的 spec / plan（格式由 superpowers 技能自治）；任务合并后移入 `archive/` | agent | 执行任务时 |
| `glossary/` ｜ `ui-contract/` | 术语表 ｜ 前端 UI 契约 | 业主 | 需要时 |
| `reference/roadmap.md` | 版本规划（V1–V9；`roadmap.en.md` 为英文渲染，中文版为唯一真相） | 业主 | 排期时 |
| `reference/truth/` | 旧现状文档；`modules/` 未覆盖的模块暂读这里，改写一份删一份 | 退役中 | 过渡期 |
| `BACKLOG.md` | 业务缺口（只登记业务缺口） | agent | 说"以后做"时 |
| `CHANGELOG.md` | 业务口径变更日志，一合并一行 | agent | 回顾时 |
| `PRODUCTION-NOTES.md` | 生产化才做的账 | agent 只追加 | **不读** |
| `archive/` | 历史存档：superpowers 存量 specs/plans/product-docs/backlog 已迁入（2026-08-26） | 只读 | **不读** |

> 改造依据：仓库根 `文档演示化改造路线图-20260826.md`。总纲（定位 / 判断标准 / 禁做清单 / 路由）见根目录 [`CLAUDE.md`](../../CLAUDE.md)。
