# doc-final —— 项目文档单一真相源

本目录是**唯一**的项目文档根。别处不再存在文档目录（壳层 `重做版/doc-final/`、旧 `Exchange_js/docs/` 已于 2026-07-03 收编删除），**禁止另立**。新增文档一律进本目录。

## 两层结构

### 🟢 活真相层 —— 平时改代码只看这里

| 目录 | 回答 |
|---|---|
| `rules/` | 必须**怎么写**代码（约束）|
| `reference/` | 代码**现在什么样**（`roadmap.md` 计划 ＋ 其英文版 `roadmap.en.md` + `truth/` 现状 + baselines）|
| `test-cases/` | **怎么验收 PRD**（TC-01…TC-09 按 PRD 的「应然」写，不按代码现值写）|
| `glossary/` | 术语表 |
| `ui-contract/` | 前端 UI 契约 |
| `BACKLOG.md` | 技术债 / 死码 / 待决策（唯一登记处）|

> 更细的四类文档分工（rules / truth / roadmap / BACKLOG）见 [`reference/truth/README.md`](reference/truth/README.md)。
> `test-cases/` 与 `truth/` 的分工：**用例写 PRD 要求的「应然」，truth 写代码的「实然」**——两者不一致即是待办，不要为迁就代码去改用例（读法见 [`test-cases/README.md`](test-cases/README.md)）。
> `roadmap.en.md` 是 `roadmap.md` 的英文渲染，**中文版为唯一真相源**，两者分歧以中文为准。

### 🗄️ 历史 / 设计存档层 —— 追溯"当初为什么这么设计"才翻

| 目录 | 内容 |
|---|---|
| `superpowers/specs/` | 历次 brainstorming 设计稿（按日期沉淀）|
| `superpowers/plans/` | 历次实施计划 |
| `superpowers/product-docs/` · `superpowers/backlog/` | 产品 / 需求存档 |

> ⚠️ 存档层是**只读历史**，记录"当初怎么设计"，**不代表当前代码现状**——现状永远以活真相层 `reference/truth/` 为准。

## 写入规范（防再散）

所有 spec / plan 一律写入 `Exchange_js/doc-final/superpowers/{specs,plans}/YYYY-MM-DD-<topic>[-design].md`。
详见根目录 [`CLAUDE.md`](../../CLAUDE.md) 「文档单一真相源」节。
