# doc-final — 读法地图

本目录是**唯一**的项目文档根，禁止在别处另立文档目录。两层关系：**`modules/` = 现状唯一真相（agent 维护）｜ `demo/script.md` + `modules/<篇>` §4 = 验收（演得出来就算过）**。两者不一致 = 待办，登记 BACKLOG。

> `prd/`（应然层）2026-08-26 规划、至今未建，PRD 仍在飞书；旧 `test-cases/`（271 条用例）2026-08-31 整体封箱进 `archive/`——它锚的是飞书 7-14 版 PRD，且不覆盖 8 月建成的异常分支，理由见 [`archive/test-cases/README.md`](archive/test-cases/README.md)。

| 位置 | 是什么 | 谁维护 | 什么时候读 |
|---|---|---|---|
| `modules/` | 各模块业务说明 + 关键技术节点（overview + 9 篇，2026-08-26 起为现状唯一真相；旧 reference/truth/ 已整体退役） | agent | 每次任务 |
| `prd/` | 需求原文（重新撰写中，篇目另定）（待建） | 业主 | 改对应模块前 |
| `demo/` | 演示剧本（七幕）/ 数据字典 / 跑分基线 / 模拟说明 ｜ **七幕主线即验收口径** | 主线业主定，其余 agent | 演示前；改页面/种子时同步；**验收时** |
| `decisions.md` | 业务决策记录，只追加 | 业主 | **动任何设计前** |
| `rules/` | 写法约束 + `delivery-checklist.md` 交付清单 + `review-rubric.md` 评审表 | 业主 | 写码 / 评审时 |
| `superpowers/{specs,plans}/` | **活层**：进行中任务的 spec / plan（格式由 superpowers 技能自治）；任务合并后移入 `archive/` | agent | 执行任务时 |
| `glossary/` ｜ `ui-contract/` | 术语表 ｜ 前端 UI 契约 | 业主 | 需要时 |
| `reference/roadmap.md` | 版本规划（V1–V9；`roadmap.en.md` 为英文渲染，中文版为唯一真相） | 业主 | 排期时 |
| `BACKLOG.md` | 业务缺口（只登记业务缺口） | agent | 说"以后做"时 |
| `CHANGELOG.md` | 业务口径变更日志，一合并一行 | agent | 回顾时 |
| `PRODUCTION-NOTES.md` | 生产化才做的账 | agent 只追加 | **不读** |
| `archive/` | 历史存档：superpowers 存量 specs/plans/product-docs/backlog 已迁入（2026-08-26） | 只读 | **不读** |

> 改造依据：[`doc-restructure-roadmap.md`](doc-restructure-roadmap.md)（原名《文档演示化改造路线图-20260826》，2026-08-31 从仓库根迁入并入版本控制）。总纲（定位 / 判断标准 / 禁做清单 / 路由）见根目录 [`CLAUDE.md`](../../CLAUDE.md)。
