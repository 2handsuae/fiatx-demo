# 第七幕波三 · 检索动线 + 收口 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"检索一键可达"成立——实体页深链进审计、Related No 拉全链、详情页把 subjects/旅程/人话标签亮出来、资金单审计栏改读中央日志、词表最全版交业主，第七幕战役收官。

**Architecture:** 后端只动 `audit-logs` 查询面三小处（keyword 补 eventNo / action 过滤 / subjectNo 扩 OR）+ 资金单 detail 摘一行 include；其余全是 admin-web 展示层（列表页 URL 参数化、详情页两个新区、六页深链按钮、资金单栏重写）+ 常量收口 + 一个新导出脚本 + 文档收官。

**Tech Stack:** NestJS + Prisma + SQLite ｜ React (admin-web, react-router `useSearchParams`) ｜ jest（`mockFindManyByWhere` 行为化 mock + where 结构断言）｜ ts-node 导出脚本

**Spec:** `doc-final/superpowers/specs/2026-09-16-act7-wave3-search-flow-design.md`（范围权威）｜ 总纲 `2026-09-15-act7-audit-campaign-charter.md` §3 波三节

## Global Constraints（每个任务隐含遵守）

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用（本 plan 末尾有本轮命中表，任务收尾对号）
- **本轮特有**：
  - **Node 20 前置**：本机 shell 默认 node18，每条 node/npm/npx 命令前先 `export PATH="$(ls -d "$HOME"/.nvm/versions/node/v20*/bin | tail -1):$PATH"`；jest 不接管道尾（吞退出码），且在 worktree 的 `Exchange_js/` 根下跑
  - **工作树**：独立 worktree `.claude/worktrees/act7_wave3/`（树名下划线）+ 独立分支 + 自动分栈（`bash scripts/stack.sh up` = self）
  - **不动 schema / seed / client-web**（⑧ 不触发；③ tsc 照跑兜底）；不动钱（⑦ 不触发）；**无新 admin 端点、无新审计码、无新权限组**（RBAC catalog 零改动）
  - **随手闸**：每任务收尾 ① `npx tsc --noEmit -p tsconfig.json`；动了 admin-web 加 ② `cd admin-web && npx tsc -b --noEmit && cd ..`；本任务相关目录 jest 全绿
  - **测试纪律**：禁止「扫源码文本」型断言；audit-logging 查询侧 mock 用 spec 顶层 `mockFindManyByWhere`（行为化）或 where **结构断言**（既有「第一批 · 按主体检索」describe 的形状），禁止 `mockResolvedValue` 无视 where 的假绿
  - **前端一律走业务键**（铁律⑥）：深链参数、跳转路由全用 `...No` / `levelCode`，不碰 UUID
  - **派发模型**（项目 CLAUDE.md §6）：任务执行与任务级评审 → sonnet；终审 → 主会话 Fable；子代理 prompt 须带项目 CLAUDE.md §0–§5 要点
  - **commit**：每任务一 commit，只 add 具名文件

---

### Task 1: 后端检索三小改（keyword 补 eventNo / action 过滤 / subjectNo 扩 OR）

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts`（keyword OR :480-488、findAll :1022-1037）
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts`（`AuditLogQueryDto` :275-357——keyword 注释 :348、subjectNo 描述 :292 一带、新增 action 字段）
- Test: `src/modules/audit-logging/audit-logs.service.spec.ts`（「第一批 · 按主体检索」describe :1174 一带）

**Interfaces:**
- Produces: `GET /admin/audit-logs` 新行为——`keyword` OR 匹配含 `eventNo`；`action=<码>` 精确过滤；`subjectNo=X` 单给时命中 `primarySubjectNo=X` **或** 子表 `subjectNo=X`（Task 2/4/5 的深链与资金单栏全靠这条）；`subjectNo`+`subjectRole` 同给维持纯子表语义
- 不波及：`prepareEvidenceExportSelection`（:617 起）只经 `buildWhere`+`id in`，不走 findAll 的 subjectNo 块；`scripts/verify-audit.ts` 直连 PrismaClient 不经服务（已实测）

- [ ] **Step 1: 改写/新增失败测试** —— 在「第一批 · 按主体检索」describe 内：

**改写**既有用例 `'传 subjectNo 时用子表关系过滤'`（:1180-1185）为：

```ts
it('subjectNo 单给时 OR 命中主表 primarySubjectNo 或子表 subjectNo（波三扩语义）', async () => {
  await service.findAll({ subjectNo: 'CUS889' } as any);
  const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
  expect(where.subjects).toBeUndefined();
  expect(where.AND).toEqual(
    expect.arrayContaining([
      {
        OR: [
          { primarySubjectNo: 'CUS889' },
          { subjects: { some: { subjectNo: 'CUS889' } } },
        ],
      },
    ]),
  );
});
```

保留 `'subjectNo 与 subjectRole 同传时落在同一个 some 里'`（:1187-1191）原样不动——它钉住"带 role 走纯子表"。**新增**两用例：

```ts
it('keyword 命中 eventNo（Audit No 假承诺修复）', async () => {
  await service.findAll({ keyword: 'AUD2609' } as any);
  const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
  const orClause = (where.AND as any[]).find((c) => Array.isArray(c.OR));
  expect(orClause.OR).toContainEqual({ eventNo: { contains: 'AUD2609' } });
});

it('action 精确过滤', async () => {
  await service.findAll({ action: 'DEPOSIT_FROZEN' } as any);
  expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.action).toBe('DEPOSIT_FROZEN');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "第一批"`
Expected: FAIL 3 处——OR 用例收到 `where.subjects={some...}` 旧形状；eventNo 用例找不到含 eventNo 的 OR 项；action 用例 `where.action` 为 undefined

- [ ] **Step 3: 实现**

`audit-logs.service.ts` keyword OR（:480-488）首行前加：

```ts
        OR: [
          { eventNo: { contains: query.keyword } },   // ← 新增：Audit No 假承诺修复（波三）
          { action: { contains: query.keyword } },
          // …其余七列原样…
        ],
```

findAll：`if (query.actionDomain)`（:1022）旁加一行；subjectNo 块（:1031-1036）整段替换：

```ts
    if (query.action) (where as any).action = query.action;
```

```ts
    if (query.subjectNo && !query.subjectRole) {
      // 波三扩语义：Related No = 主对象或任一相关主体。subjects 子表只覆盖名册码
      // （SUBJECTS_COVERED_ACTIONS），交易域主链事件只在主表列上，纯子表查询拉不全。
      // 不直接挂 where.OR——buildWhere 可能已把 keyword 的 OR 返回为顶层子句，会被覆写。
      const subjectClause = {
        OR: [
          { primarySubjectNo: query.subjectNo },
          { subjects: { some: { subjectNo: query.subjectNo } } },
        ],
      };
      (where as any).AND = Array.isArray((where as any).AND)
        ? [...(where as any).AND, subjectClause]
        : (where as any).AND
          ? [(where as any).AND, subjectClause]
          : [subjectClause];
    } else if (query.subjectNo || query.subjectRole) {
      const some: Record<string, string> = {};
      if (query.subjectNo) some.subjectNo = query.subjectNo;
      if (query.subjectRole) some.subjectRole = query.subjectRole;
      (where as any).subjects = { some };
    }
```

`audit-log.dto.ts`：`AuditLogQueryDto` 内 `actionDomain` 字段后加：

```ts
  @ApiPropertyOptional({ description: '动作码精确过滤，例如 DEPOSIT_FROZEN' })
  @IsOptional()
  @IsString()
  action?: string;
```

keyword 注释（:348）改为：`'关键字，OR 匹配 eventNo/action/primarySubjectType/primarySubjectNo/actorNo/ownerCustomerNo/traceId/reason'`；subjectNo 描述（:292 一带）改为：`'按主体业务键检索——命中主对象（primarySubjectNo）或任一相关主体（子表），监管索档的主入口；与 subjectRole 同传时只查子表'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/audit-logging` ｜ Expected: 全绿（含既有全部用例——特别确认 :1187 带 role 用例仍绿）

- [ ] **Step 5: 随手闸 + Commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/dto/audit-log.dto.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "feat(审计波三): 检索三小改——keyword补eventNo/action精确过滤/subjectNo扩OR(主表∨子表),Audit No假承诺坐实,DTO注释改真"
```

---

### Task 2: 审计列表页——URL 参数收口 + 筛选补栏 + ListFooter

**Files:**
- Modify: `admin-web/src/pages/AuditLogsPage.tsx`（全文见现状：FilterState :50-74、buildSearchParams :105-129、mount :228-230、主栏 :271-319、高级栏 :322-365、Pagination :559-567）

**Interfaces:**
- Consumes: Task 1 的 `action` 查询参数
- Produces: 审计页 URL 契约 `/admin/audit/logs?<filters>`——支持 `keyword/primarySubjectNo/subjectNo/actorNo/ownerCustomerNo/traceId/outcome/actionDomain/action/workflowType/correlationId/startAt/endAt/includeArchived`，进页自动查询。Task 3 的 View journey、Task 4 的深链按钮、Task 5 的 View full trail 都指向这个契约

- [ ] **Step 1: 实现**（前端无单测能力，.spec.tsx 静默不跑——判例在案；验证靠 tsc + Task 8 截图）

① import 行：`react-router-dom` 增 `useSearchParams`；`Pagination` import 删，换 `import { ListFooter } from '../components/common/ListFooter';`

② `FilterState`（:50-61）与 `DEFAULT_FILTERS`（:63-74）各增四字段：`actionDomain: string; action: string; workflowType: string; correlationId: string;`（默认 `''`）。文件顶部加常量：

```ts
/** 与词表 11 域一致（+落库默认值 UNCLASSIFIED）。域清单几年不变一次，不值得建接口。 */
const ACTION_DOMAINS = [
  'APPROVAL', 'IAM', 'CONFIG', 'AUDIT', 'CUSTOMER', 'DEPOSIT',
  'WITHDRAW', 'SWAP', 'TREASURY', 'RECON', 'GOVERNANCE', 'UNCLASSIFIED',
] as const;

const URL_FILTER_KEYS = [
  'keyword', 'primarySubjectNo', 'subjectNo', 'actorNo', 'ownerCustomerNo', 'traceId',
  'outcome', 'actionDomain', 'action', 'workflowType', 'correlationId', 'startAt', 'endAt',
] as const;
```

③ 组件内加 URL 双向转换（`const [searchParams, setSearchParams] = useSearchParams();`）：

```ts
  const filtersFromUrl = (params: URLSearchParams): { initial: FilterState; hasAny: boolean } => {
    const initial: FilterState = { ...DEFAULT_FILTERS };
    let hasAny = false;
    URL_FILTER_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) {
        (initial as Record<string, unknown>)[key] = value;
        hasAny = true;
      }
    });
    if (params.get('includeArchived') === 'true') {
      initial.includeArchived = true;
      hasAny = true;
    }
    return { initial, hasAny };
  };

  const filtersToUrl = (f: FilterState): URLSearchParams => {
    const params = new URLSearchParams();
    URL_FILTER_KEYS.forEach((key) => {
      const value = String((f as Record<string, unknown>)[key] ?? '').trim();
      if (value) params.set(key, value);
    });
    if (f.includeArchived) params.set('includeArchived', 'true');
    return params;
  };
```

④ `buildSearchParams`（:105-129）在 outcome 行后补四段（写法照既有行）：`actionDomain` 直 set，`action`/`workflowType`/`correlationId` trim 后 set。

⑤ mount effect（:228-230）替换为：

```ts
  useEffect(() => {
    const { initial, hasAny } = filtersFromUrl(searchParams);
    if (!hasAny) {
      void fetchLogs(1, DEFAULT_FILTERS);
      return;
    }
    setFilters(initial);
    // 深链带进来的高级栏字段要看得见，否则预填了也不知道在筛什么
    if (
      initial.primarySubjectNo || initial.subjectNo || initial.ownerCustomerNo ||
      initial.action || initial.workflowType || initial.correlationId ||
      initial.startAt || initial.endAt || initial.includeArchived
    ) {
      setShowAdvanced(true);
    }
    void fetchLogs(1, initial);
  }, []);
```

⑥ 搜索/重置回写 URL：新增 `const handleSearch = () => { setSearchParams(filtersToUrl(filters), { replace: true }); void fetchLogs(1, filters); };`，两处 Search 按钮 onClick 换 `handleSearch`；`handleReset`（:171-177）内加 `setSearchParams(new URLSearchParams(), { replace: true });`

⑦ 主栏（outcome select 之后）加域下拉：

```tsx
        <select
          value={filters.actionDomain}
          onChange={(e) => setFilters((p) => ({ ...p, actionDomain: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All Domains</option>
          {ACTION_DOMAINS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
```

⑧ 高级栏（ownerCustomerNo input 之后）加三个输入框，同款 `fi` 样式：placeholder 分别 `Action Code`（w-40）、`Workflow Type`（w-36）、`Correlation ID`（w-40），onChange 各写对应字段。

⑨ 页脚（:559-567）整段替换：

```tsx
      <ListFooter
        filteredCount={items.length}
        total={total}
        noun="record"
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => void fetchLogs(page, filters)}
      />
```

- [ ] **Step 2: 闸**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..` ｜ Expected: 0 错误

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/AuditLogsPage.tsx
git commit -m "feat(审计波三): 列表页URL参数收口(深链契约+回写)+筛选补栏(域下拉/action/workflowType/correlationId)+套ListFooter"
```

---

### Task 3: 审计详情页——旅程渲染 + Related Subjects 区 + 人话标签

**Files:**
- Modify: `admin-web/src/pages/AuditLogDetailPage.tsx`（interface :16-49、Hero :263-305、Entity 区 :328-365、Workflow 区 :367-380）

**Interfaces:**
- Consumes: 后端 `findOne` 既有回传（`mapEvent` 已含 `correlationId/causationId/userActionLabel/businessWorkflowLabel`，`subjects` 数组 :1085-1090）——**零后端改动**
- Consumes: Task 2 的 URL 契约（View journey 跳 `?correlationId=`）
- Produces: 无下游依赖

- [ ] **Step 1: 实现**

① `AuditLogDetail` interface 补五字段：

```ts
  correlationId?: string | null;
  causationId?: string | null;
  userActionLabel?: string | null;
  businessWorkflowLabel?: string | null;
  subjects?: { subjectType: string; subjectNo: string; subjectRole: string }[];
```

② Hero 区 Action 码行（:270）之后加人话标签（后端早已回传、从未渲染——可读性白捡）：

```tsx
                {(detail.userActionLabel || detail.businessWorkflowLabel) && (
                  <p className="mt-1 text-[11px] text-adm-t2">
                    {[detail.userActionLabel, detail.businessWorkflowLabel].filter(Boolean).join(' · ')}
                  </p>
                )}
```

③ 组件体内（:234 一带布尔值旁）加派生值，并把 `hasWorkflow` 扩成四字段：

```ts
  /** PRIMARY 镜像行与上方 Entity 区重复，不进本区；角色固定顺序展示 */
  const ROLE_ORDER = ['OWNER', 'INSTRUMENT', 'RELATED', 'COUNTERPARTY'];
  const relatedSubjects = ROLE_ORDER.flatMap((role) =>
    (detail.subjects ?? []).filter((s) => s.subjectRole === role),
  );
  const hasWorkflow = !!(detail.workflowType || detail.traceId || detail.correlationId || detail.causationId);
```

④ Entity 区 section 结束标签后、Workflow 区之前插入新区：

```tsx
          {/* ── 3b · RELATED SUBJECTS ──────────────────────────────
               波二写进子表的"这件事牵连了谁"。此前只能在 Raw Record 的 JSON 里肉眼扒。
               映射命中的号可点跳转（甲案：映射缺席保持纯文本，不硬造）。 ── */}
          {relatedSubjects.length > 0 && (
            <section className="px-6 py-5">
              <Cap>Related Subjects</Cap>
              <div className="mt-3 flex flex-col gap-2">
                {relatedSubjects.map((s) => {
                  const route = AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[s.subjectType];
                  return (
                    <div key={`${s.subjectRole}-${s.subjectType}-${s.subjectNo}`} className="flex items-center gap-3">
                      <span className="w-[110px] shrink-0"><AdminBadge value={s.subjectRole} /></span>
                      <span className="w-[180px] shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                        {s.subjectType}
                      </span>
                      {route ? (
                        <span
                          className="cursor-pointer break-all font-mono text-[11px] font-semibold text-adm-blue hover:underline"
                          onClick={() => navigate(route(s.subjectNo))}
                        >
                          {s.subjectNo}
                        </span>
                      ) : (
                        <span className="break-all font-mono text-[11px] font-semibold text-adm-amber">{s.subjectNo}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
```

⑤ Workflow 区（:370-380）扩为：

```tsx
          {hasWorkflow && (
            <section className="px-6 py-5">
              <Cap>Workflow</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field label="Type"         value={detail.workflowType} />
                  <Field label="Trace ID"     value={detail.traceId}     mono full />
                  <Field label="Causation ID" value={detail.causationId} mono full />
                </FieldGrid>
                {detail.correlationId && (
                  <div className="mt-4">
                    <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                      Correlation ID (Journey)
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="break-all font-mono text-[10px] text-adm-t2">{detail.correlationId}</p>
                      <button
                        onClick={() =>
                          navigate(`/admin/audit/logs?correlationId=${encodeURIComponent(detail.correlationId!)}`)
                        }
                        className={adminButtonClass('rowLink')}
                      >
                        View journey →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
```

⚠️ Raw Record 区（:137-167）**零改动**——乙案过滤照旧；`stripInternalIds` 会把新 interface 字段一并进 JSON，subjects 数组里全是业务键，无泄漏面。

- [ ] **Step 2: 闸**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..` ｜ Expected: 0 错误

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/AuditLogDetailPage.tsx
git commit -m "feat(审计波三): 详情页可读性收口——Related Subjects区(角色分组+可点跳转)/correlationId·causationId渲染+View journey/人话标签"
```

---

### Task 4: ViewAuditTrailButton 共享组件 + 六页深链接入

**Files:**
- Create: `admin-web/src/components/common/ViewAuditTrailButton.tsx`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（DetailPageHeader :515-520）
- Modify: `admin-web/src/pages/WithdrawTransactionDetail.tsx`（:377 一带）
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`（:378 一带）
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`（:425 一带）
- Modify: `admin-web/src/pages/AssetDetail.tsx`（:216 一带）
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（:641 一带）

**Interfaces:**
- Consumes: Task 2 的 URL 契约；`DetailPageHeader` 的 `children` 插槽（`DetailPageComponents.tsx:57-58` 渲染为右侧动作区）
- Produces: `ViewAuditTrailButton({ params }: { params: Record<string, string> })`——Task 5 复用（View full trail 变体不复用本组件，栏内自绘链接，见 Task 5）

- [ ] **Step 1: 建组件**

```tsx
import { useNavigate } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { adminButtonClass } from './adminButtonStyles';

/** 实体详情页 → 审计页深链（第七幕波三，判据3：零人肉抄号切页）。
 *  params 直接拼进审计列表页 URL 契约（AuditLogsPage 进页自动查询）。 */
export const ViewAuditTrailButton = ({ params }: { params: Record<string, string> }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`/admin/audit/logs?${new URLSearchParams(params).toString()}`)}
      className={adminButtonClass('detailUtility')}
    >
      <ScrollText size={13} />
      View audit trail
    </button>
  );
};
```

（若 `adminButtonClass` 无 `detailUtility` 变体报 tsc 错，照 `AuditLogDetailPage.tsx:199` 实际用的变体名对齐——那里就是 `detailUtility`，已实证。）

- [ ] **Step 2: 六页接入** —— 每页 `DetailPageHeader` 加 children（自闭合改包裹式），import 组件。参数用各页 `useParams` 已有变量：

| 页 | useParams 变量（已实证） | children |
|---|---|---|
| DepositTransactionDetail | `depositNo`（:204） | `<ViewAuditTrailButton params={{ subjectNo: depositNo! }} />` |
| WithdrawTransactionDetail | `withdrawNo`（:173） | 同款 `subjectNo: withdrawNo!` |
| SwapTransactionDetail | `swapNo`（:165） | 同款 `subjectNo: swapNo!` |
| ApprovalDetailPage | `approvalNo`（:172） | 同款 `subjectNo: approvalNo!` |
| AssetDetail | `assetNo`（:87） | 同款 `subjectNo: assetNo!` |
| CustomerDetail | `customerNo`（:182） | `<ViewAuditTrailButton params={{ ownerCustomerNo: customerNo! }} />`——owner 列全域事件都写（subjects 只覆盖 47/263 码），客户全轨迹靠它 |

写法示例（DepositTransactionDetail :515）：

```tsx
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/deposits')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Deposits"
      >
        <ViewAuditTrailButton params={{ subjectNo: depositNo! }} />
      </DetailPageHeader>
```

若某页 `DetailPageHeader` 已有 children（其他动作按钮），把本按钮**追加在末位**，不动既有按钮。

- [ ] **Step 3: 闸 + Commit**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`

```bash
git add admin-web/src/components/common/ViewAuditTrailButton.tsx admin-web/src/pages/DepositTransactionDetail.tsx admin-web/src/pages/WithdrawTransactionDetail.tsx admin-web/src/pages/SwapTransactionDetail.tsx admin-web/src/pages/ApprovalDetailPage.tsx admin-web/src/pages/AssetDetail.tsx admin-web/src/pages/CustomerDetail.tsx
git commit -m "feat(审计波三): View audit trail深链——共享按钮组件+六页接入(三域订单/审批/资产走subjectNo,客户走ownerCustomerNo)"
```

---

### Task 5: 资金单详情审计栏改读中央审计日志（岔口甲）+ 死读取链摘除

**Files:**
- Modify: `src/modules/funds-orders/funds-order.service.ts`（:363 一行删）
- Modify: `admin-web/src/pages/FundsOrderDetail.tsx`（`FoAuditLog` :59 起、`auditLogs` 字段 :99、Audit Log 卡 :577-580、`AuditLogList` 组件 :782-816）
- Test: `src/modules/funds-orders/`（既有 spec 全绿即可——include 摘除是纯读面收窄）

**Interfaces:**
- Consumes: Task 1 的 subjectNo OR 语义（FUNDS_ORDER 事件主表 primary + 三域 RELATED 子表行一次拉全）；Task 2 的 URL 契约
- Produces: 无下游依赖。`InternalFundAuditLog` 自此读写双死（删表留下次动 schema）

- [ ] **Step 1: 后端摘 include**

`funds-order.service.ts:363` 删除 `auditLogs: { orderBy: { createdAt: 'desc' } },` 一行。全量复核消费方：

Run: `grep -rn "auditLogs" src/modules/funds-orders/ admin-web/src/pages/FundsOrderDetail.tsx`
Expected: 后端仅 :363 一处（改前）；前端仅本任务要删的三处。有别的命中 → 停下按零引用纪律逐个处置再继续。

- [ ] **Step 2: 跑后端测试**

Run: `npx jest src/modules/funds-orders` ｜ Expected: 全绿（若有用例断言 auditLogs 字段，连带删断言——它断言的是死表内容）

- [ ] **Step 3: 前端重写审计栏**

删 `FoAuditLog` interface、`FundsOrderDetail.auditLogs` 字段、`AuditLogList` 组件整段；`lucide-react` import 里 `User` 若因此孤儿则连带删（先 grep 本文件其余用点）。「6. Audit Log」卡替换为：

```tsx
          {/* 6. Audit Trail —— 波三甲案：直调中央审计日志（subjectNo=本单号），
              死表 InternalFundAuditLog 读取链已摘。 */}
          <DetailCard title="Audit Trail" columns={1}>
            <CentralAuditTrail fundsOrderNo={data.fundsOrderNo} />
          </DetailCard>
```

文件内（`AuditLogList` 原位置）加组件（`adminFetch`/`AdminSessionError`/`getApiErrorMessage`/`AdminBadge` 等 import 以文件现状为基础补齐）：

```tsx
interface CentralAuditRow {
  id: string;
  eventNo: string;
  action: string;
  outcome: string;
  actorNo?: string | null;
  occurredAt: string;
}

const CentralAuditTrail = ({ fundsOrderNo }: { fundsOrderNo: string }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CentralAuditRow[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/audit-logs?subjectNo=${encodeURIComponent(fundsOrderNo)}&take=10`,
        );
        if (res.status === 403) {
          setDenied(true);
          setRows([]);
          return;
        }
        if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load audit trail.'));
        const data = (await res.json()) as { items?: CentralAuditRow[] };
        setRows(Array.isArray(data.items) ? data.items : []);
      } catch (e: unknown) {
        if (e instanceof AdminSessionError) return;
        setRows([]);
      }
    })();
  }, [fundsOrderNo]);

  if (denied) {
    return <p className="py-2 font-mono text-[11px] text-adm-t3">Audit log access is not granted for this role.</p>;
  }
  if (rows === null) {
    return <p className="py-2 font-mono text-[11px] text-adm-t3">Loading…</p>;
  }
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="py-2 font-mono text-[11px] text-adm-t3">No audit records.</p>}
      {rows.map((row) => (
        <div
          key={row.id}
          className="cursor-pointer rounded border border-adm-border bg-adm-bg px-3 py-2 transition-colors hover:bg-adm-hover"
          onClick={() => navigate(`/admin/audit/logs/${row.eventNo}`)}
        >
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="font-semibold text-adm-amber">{row.eventNo}</span>
            <span className="text-adm-t1">{row.action}</span>
            <AdminBadge value={row.outcome} />
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
            <span className="font-mono">{row.actorNo ?? 'SYSTEM'}</span>
            <span>·</span>
            <time className="font-mono">{new Date(row.occurredAt).toLocaleString()}</time>
          </div>
        </div>
      ))}
      <button
        onClick={() => navigate(`/admin/audit/logs?subjectNo=${encodeURIComponent(fundsOrderNo)}`)}
        className={adminButtonClass('rowLink')}
      >
        View full trail →
      </button>
    </div>
  );
};
```

（`data.fundsOrderNo` 取自详情响应；若响应类型里字段名不同，以 `useParams` 的 `fundsOrderNo`（:185 已实证）传参兜底。）

- [ ] **Step 4: 闸 + Commit**

Run: `npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd ..`

```bash
git add src/modules/funds-orders/funds-order.service.ts admin-web/src/pages/FundsOrderDetail.tsx
git commit -m "feat(审计波三): 资金单审计栏改读中央审计日志(甲案,subjectNo=单号,最近10条+View full trail)——InternalFundAuditLog读取链摘除,读写双死"
```

---

### Task 6: 常量与映射收口——FUNDS_ORDER 收编 + 15 孤儿键删 + 费率映射两行

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditEntityTypes` :1-44）
- Modify: `admin-web/src/pages/auditEntityRoutes.ts`
- Modify（FUNDS_ORDER 字面量 9 处，7 文件均已 import `AuditEntityTypes`，只换值不加 import）：
  - `src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts` :242 :250
  - `src/modules/funds-orders/funds-order-advance-workflow.service.ts` :47 :50
  - `src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts` :338
  - `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` :1807
  - `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` :1316
  - `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` :1940
  - `src/modules/trading/swap-transactions/swap-workflow.service.ts` :1457

**Interfaces:**
- Produces: `AuditEntityTypes.FUNDS_ORDER`；映射表新键 `WITHDRAWAL_FEE_LEVEL` / `SWAP_FEE_LEVEL`
- ⚠️ `wallet-recon-run.service.ts:901` 的 `internalSourceType: 'FUNDS_ORDER'` 是业务字段**非审计主体类型，不动**
- ⚠️ `ONBOARDING`/`CONFIG` 等键名与 `AuditWorkflowTypes`/actionDomain 字符串撞名——删的只是 `AuditEntityTypes` 的键

- [ ] **Step 1: 零引用预检（先扫后删，四形态）** —— 对 15 个候选键逐个跑（`<KEY>` 依次替换）：

```bash
grep -rn "AuditEntityTypes\.<KEY>\b" src admin-web/src client-web/src scripts test --include='*.ts' --include='*.tsx' | grep -v "constants/audit-actions.constant.ts"
grep -rnE "(subjectType|primarySubjectType|SubjectType)\s*[:=]+\s*'<KEY>'" src admin-web/src client-web/src scripts test --include='*.ts' --include='*.tsx'
```

候选 15 键（2026-09-16 主会话双形态实测均 0）：`SHAREHOLDING_REGISTRY_VERSION` `APPOINTMENT_RECORD` `REGULATORY_GATE_ITEM` `TRAINING_RECORD` `CONFLICT_DISCLOSURE` `WIND_DOWN_MATERIAL` `ONBOARDING` `PAYIN` `PAYOUT` `INTERNAL_FUND` `AUTH` `CONFIG` `LIQUIDITY_CONFIG` `COA` `TB_ACCOUNT`
Expected: 全部 0 命中。**任一键非 0 → 该键不删**，留在常量里并在任务报告写明命中处（体检记录 rot 属正常，以重扫为准）。

- [ ] **Step 2: 改常量与九处字面量**

`AuditEntityTypes`：删过检的孤儿键；在 `INCIDENT` 行后加 `FUNDS_ORDER: 'FUNDS_ORDER',`（带一行注释：`// 波三收编（2026-09-16）：此前 push-order/advance-workflow 等 9 处字面量`）。九处 `'FUNDS_ORDER'` 换 `AuditEntityTypes.FUNDS_ORDER`（`subjectRole: 'PRIMARY'` 之类字符串不在本任务范围，不顺手改）。

- [ ] **Step 3: 映射补两行**

`auditEntityRoutes.ts` 加（路由 `App.tsx:238/:240` 实证，`:levelCode` 参数；写点 `fee-level-workflow.base.ts:83` primarySubjectNo=levelCode 实证闭环）：

```ts
  WITHDRAWAL_FEE_LEVEL: (no) => `/admin/pricing/withdrawal-fee-levels/${no}`,
  SWAP_FEE_LEVEL: (no) => `/admin/pricing/swap-fee-levels/${no}`,
```

头注释（:4-5）「FUNDS_ORDER 不在 AuditEntityTypes 常量里…必须收编」整句删（本任务已收编，注释留着就成谎言）。

- [ ] **Step 4: 闸**（tsc 是本任务主闸——键删漏了消费方、值换错了字面量都在这红）

Run: `npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd ..`
Run: `npx jest src/modules/funds-orders src/modules/clearing-settle/reconciliation/disposition` ｜ Expected: 全绿（值恒等替换，行为零变化）

- [ ] **Step 5: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts admin-web/src/pages/auditEntityRoutes.ts src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts src/modules/funds-orders/funds-order-advance-workflow.service.ts src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.ts
git commit -m "refactor(审计波三): FUNDS_ORDER收编入AuditEntityTypes(9处字面量换常量)+15孤儿键零引用重扫后删除+映射补费率两族"
```

---

### Task 7: 词表导出脚本入库 + 最全版生成（判据 6）

**Files:**
- Create: `scripts/export-audit-vocab.ts`
- Modify: `package.json`（scripts 加一行）
- Create（脚本产物）: `doc-final/lark/2026-09-16-audit-actions-catalog-full.md`

**Interfaces:**
- Consumes: `audit-actions.constant.ts` 的 8 份名册（`V1_AUDIT_ACTIONS` / `V4_DEPOSIT_` / `V5_WITHDRAW_` / `V6_SWAP_` / `V8_RECON_` / `V2_CUSTOMER_` / `V7_TREASURY_` / `INCIDENT_AUDIT_ACTIONS`）+ `DEPRECATED_AUDIT_ACTIONS` + `SUBJECTS_COVERED_ACTIONS`；种子文档 `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md`（说明列与分组结构的唯一来源——说明是人写的，常量里没有）
- Produces: 最全版 = 9-15 版结构 + 机器列全部从常量重导 + 新增 **subjects ✓ 列**（47 码名册标记）+ 退役码附录全列（不再"仅列名"截断）

- [ ] **Step 1: 写脚本** —— 设计要点（完整实现照此写，约 150 行）：

```ts
/**
 * 审计动作码全量导出（第七幕波三，判据6）。
 * 机器事实（域/旅程/必填/异步/subjects名册）从常量重导——常量是唯一真相；
 * 说明列与"域内分组"结构从上一版种子文档解析——说明是人写的，代码里没有。
 * 名册与种子对不上 = 有码没说明/有说明没码 → 当场 fail-fast 列清单退出（exit 1），
 * 不允许静默出一份缺行的"最全版"（一次性操作失败要响，CLAUDE.md 证据纪律）。
 */
import * as fs from 'fs';
import {
  V1_AUDIT_ACTIONS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS,
  V6_SWAP_AUDIT_ACTIONS, V8_RECON_AUDIT_ACTIONS, V2_CUSTOMER_AUDIT_ACTIONS,
  V7_TREASURY_AUDIT_ACTIONS, INCIDENT_AUDIT_ACTIONS,
  DEPRECATED_AUDIT_ACTIONS, SUBJECTS_COVERED_ACTIONS, AuditActionSpec,
} from '../src/modules/audit-logging/constants/audit-actions.constant';
import { AuditCorrelationMode } from '../src/modules/audit-logging/dto/audit-log.dto';

const SEED = process.argv[2] ?? 'doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md';
const OUT = 'doc-final/lark/2026-09-16-audit-actions-catalog-full.md';

const ALL: Record<string, AuditActionSpec> = {
  ...V1_AUDIT_ACTIONS,
  ...V4_DEPOSIT_AUDIT_ACTIONS,
  ...V5_WITHDRAW_AUDIT_ACTIONS,
  ...V6_SWAP_AUDIT_ACTIONS,
  ...V8_RECON_AUDIT_ACTIONS,
  ...V2_CUSTOMER_AUDIT_ACTIONS,
  ...V7_TREASURY_AUDIT_ACTIONS,
  ...INCIDENT_AUDIT_ACTIONS,
};
```

- **种子解析**：逐行扫种子文档，捕获 `## <域名> 域` 节头、`### <分组名>（N）` 分组头、表行 ``| `CODE` | 说明 | …``，建 `code → { domain, group, desc }`；同时保留节/组的出现顺序与节导语文本。
- **对账 fail-fast**：`Object.keys(ALL)` 与种子码集合做双向差集，任一侧非空 → 打印两张清单 + `process.exit(1)`（现役名册自 9-15 起零增减，预期为空；真出现差集说明名册动了，先把新码的说明补进种子文档对应节再重跑）。
- **输出**：照种子的域顺序/分组结构重排版；每行 = `` | `CODE` | 说明(种子) | 旅程(S 起始/I 继承/N 单步 ← spec.correlationMode) | 必填字段(spec.requiredFields.join(', ')) | 异步(spec.requiresCausation ? '✓' : '') | subjects(SUBJECTS_COVERED_ACTIONS.includes(code) ? '✓' : '') | ``；表头行加 **subjects** 列并在文档导言里说明（"✓=该码已落五角色子表，Related No 可直接检索"）。
- **计数**：分域计数行从 `ALL` 按 `spec.domain` 分组重算（不抄种子），末尾 `合计 N 码`；导言注明生成日期 + `git rev-parse --short HEAD` 基线 + 来源文件 + 名册 47 说明。
- **附录**：`DEPRECATED_AUDIT_ACTIONS` 全列（每行一码），标题注明"退役码进拒写闸，共 N 码"。
- **落盘**：`fs.writeFileSync(OUT, …)`，stdout 打印分域计数与合计供人工核对。

`package.json` scripts 区加：

```json
    "audit:vocab": "ts-node -r tsconfig-paths/register scripts/export-audit-vocab.ts",
```

- [ ] **Step 2: 跑通 + 交叉核对**

Run: `npm run audit:vocab`
Expected: 生成 `doc-final/lark/2026-09-16-audit-actions-catalog-full.md`，stdout 计数合计 = 263（若名册自 9-15 后有增减，以 `grep -cE "^  [A-Z_]+:" ` 逐名册重数为准，两边必须相等）。人工抽查 3 码（一个 V1、一个 DEPOSIT、一个 INCIDENT）：说明与 9-15 版一致、机器列与常量一致、subjects 列与名册一致。

- [ ] **Step 3: 变异测试（闸能咬人）** —— 复制种子为临时文件删掉任意一行码表行，指给脚本：

Run: `sed '/APPROVAL_GRANTED/d' doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md > /tmp/vocab-seed-mutated.md && npm run audit:vocab -- /tmp/vocab-seed-mutated.md; echo "exit=$?"`
Expected: 打印缺失码清单含 `APPROVAL_GRANTED`，`exit=1`，且 **OUT 文件未被改写**（脚本须先对账后写盘）。跑完 `rm /tmp/vocab-seed-mutated.md`，再用真种子重跑一次确认仍绿（红绿双证）。

- [ ] **Step 4: 闸 + Commit**

Run: `npx tsc --noEmit -p tsconfig.json`（scripts/ 在 ① 覆盖内）

```bash
git add scripts/export-audit-vocab.ts package.json doc-final/lark/2026-09-16-audit-actions-catalog-full.md
git commit -m "feat(审计波三): 词表导出脚本入库(npm run audit:vocab,机器列从常量重导+说明从种子合并+差集fail-fast)——最全版生成,新增subjects名册列+退役码附录全列(判据6)"
```

---

### Task 8: 收尾闸 + 判据 3 走查实证（⑤⑥）

**Files:**
- Create: `doc-final/superpowers/checkups/act7-wave3-walkthrough/`（截图物证目录，文件名按下表）

**Interfaces:**
- Consumes: Task 1-7 全部产出。本任务零代码改动——发现 bug 回对应 Task 修，修完从本任务 Step 1 重来

- [ ] **Step 1: 全量随手闸**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/audit-logging src/modules/funds-orders
```

Expected: 全绿。

- [ ] **Step 2: 起栈 + ⑥ demo:all**

```bash
bash scripts/stack.sh up          # worktree 内 = self 栈
bash scripts/on-stack.sh self demo:all
```

Expected: 终态断言全绿（判据对照 `doc-final/demo/baseline.md`）。

- [ ] **Step 3: verify:audit 复跑**（判据 5 常绿确认，非本波判据但不许打破）

Run: `bash scripts/on-stack.sh self verify:audit`
Expected: 全绿。Q5（谁查过审计日志）若红：本波走查步骤本身会真查审计页，按波二 runbook 顺序（reset → up → demo:all → 走查 → 复跑）即绿，不改判据。

- [ ] **Step 4: ⑤ 截图走查（preview 渲染，tsc 不算数）** —— 起 admin-web preview，用种子管理员登录，逐张落盘到物证目录：

| # | 操作 | 截图断言 | 文件名 |
|---|---|---|---|
| 1 | 审计列表页 | 主栏见域下拉、高级栏见 Action Code/Workflow Type/Correlation ID 三框；页脚 ListFooter 恒显示 | `01-list-filters.png` |
| 2 | 手输 URL `/admin/audit/logs?actionDomain=DEPOSIT` | 下拉预填 DEPOSIT、列表已自动过滤 | `02-url-prefill.png` |
| 3 | keyword 输一个真实 AUD 号搜索 | 命中该条（假承诺修复实证） | `03-keyword-audno.png` |
| 4 | 充值单详情页（第三幕被冻那笔） | 头部见 View audit trail 按钮 | `04-deposit-button.png` |
| 5 | 点按钮落审计页 | Related No 预填该 DEP 号、全链含 DEPOSIT_FROZEN 与审批码（OR 语义实证） | `05-deposit-trail.png` |
| 6 | 点开链上一条带 subjects 的事件详情 | Related Subjects 区按角色分组、号可点；Action 码下见人话标签；Workflow 区见 Correlation ID + View journey | `06-detail-subjects.png` |
| 7 | 点 View journey | 列表按 correlationId 过滤、URL 带参数 | `07-journey.png` |
| 8 | 客户详情（Carol）点 View audit trail | ownerCustomerNo 预填、她名下事件拉出 | `08-customer-trail.png` |
| 9 | 提现单详情（第五幕大额那笔）点按钮 | 提现主链 + 大额审批单同屏（判据 3 第⑤步） | `09-withdraw-trail.png` |
| 10 | 审批单 / 资产详情页按钮各点一次 | 各自落页有结果 | `10-approval-asset.png`（拼图或两张） |
| 11 | 资金单详情页 | Audit Trail 栏渲染中央日志最近事件 + View full trail；点行进审计详情 | `11-fundsorder-trail.png` |

任何一张断言不成立 = bug，回对应 Task 修（走查是闸不是仪式——波五判例：截图闸不可批量后置，本任务一次清完）。

- [ ] **Step 5: Commit（物证入库）**

```bash
git add doc-final/superpowers/checkups/act7-wave3-walkthrough/
git commit -m "test(审计波三): 判据3走查物证——11张截图(深链/OR全链/subjects区/旅程/资金单栏),demo:all+verify:audit全绿"
```

---

### Task 9: 文档收口 + 记账收官（判据验收）

**Files:**
- Modify: `doc-final/modules/v1-governance.md`（§4 / §5:58 / §6:65）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（头注释 :688 / :760 / :817）
- Modify: `doc-final/demo/script.md`（:212-217 第七幕节）
- Modify: `doc-final/BACKLOG.md`、`doc-final/CHANGELOG.md`
- Modify: `doc-final/superpowers/specs/2026-09-15-act7-audit-campaign-charter.md`（状态行 + 验收记录节）

**Interfaces:**
- Consumes: Task 8 走查结果（剧本深链版照实测写）；Task 7 词表产物

- [ ] **Step 1: 数字收口（先重数再写，不抄总纲期望值）**

- 各名册码数：`grep -cE "^  [A-Z_0-9]+:" src/modules/audit-logging/constants/audit-actions.constant.ts` 按名册段逐个数（或从 Task 7 脚本 stdout 抄分域计数）。
- `audit-actions.constant.ts` 三块名册头注释改真：:688「充值域名册…31 码」、:760「提现域…25 码」、:817「兑换域…18 码」→ 实数（总纲期望 47/33/26，以重数为准），并各加一句「（2026-09-16 波三订正，历史版本号不动）」。
- `v1-governance.md:58`：V1 合同「101 码」与退役「97 码」→ 实数（总纲期望 102/113）；S/I/N 分布若变一并订正。
- `v1-governance.md:65`：整句改写——「按业务号经子表检索只覆盖 7/101」的前提已被波三 OR 语义废除。新口径：**Related No 检索 = 主表 primarySubjectNo ∨ 子表 subjectNo，全码覆盖；子表五角色名册 47 码**（引用 `SUBJECTS_COVERED_ACTIONS`），第七幕按新口径演。
- `v1-governance.md` §4「按旅程看邀请」段：补一句已兑现（详情页 Correlation ID + View journey，波三）。
- `script.md:217`：「兑换 22 码」→ 实数（期望 26）。

- [ ] **Step 2: 剧本升级深链版** —— `script.md:214` 走查段改写（保持原五步骨架与语气，动作换深链）：

① 第三幕被冻充值单**详情页点 View audit trail** → 全链拉出（含 DEPOSIT_FROZEN），点开事件详情看 Related Subjects/人话标签；② **客户详情页（Carol）点 View audit trail** → 名下全轨迹；③ 点进账本凭证核对钱的去向（不变，非深链项）；④ 审计页 Actor No 输内审账号 → ADMIN_ACCESS_DENIED（不变）；⑤ 第五幕大额提现单**详情页点 View audit trail** → 提现链 + 大额审批单同屏。段首加一句：「本幕全程零抄号——每次进审计页都是从单据页一键深链（波三，判据 3）」。同段「审计跳转甲案」句子保留（Entity No 反向跳转仍在）。`demo/data.md` 全文扫一遍审计相关描述（预期零改动，扫完在任务报告记一句）。

- [ ] **Step 3: BACKLOG 销账**（逐条找到原文划账，找不到的在报告里说明）：§H correlationId 条、跳转映射条、InternalFundAuditLog 条、Audit No 假承诺条、Related Subjects 观察条（波二 Task 10 登记）、小账条里 DTO keyword 注释 / FUNDS_ORDER 字面量两目；§K ⑥⑦ 审计子集。§I ListFooter 清单 AuditLogsPage 划掉。新增一行：InternalFundAuditLog 读写双死，删表留下次动 schema。

- [ ] **Step 4: 战役收官记账**

- 总纲状态行回写：波三已完成（分支、commit 区间、闸与走查结果一句话）。
- 总纲文末加「战役验收（2026-09-16）」节：六条战役级判据逐条一行——判据 1/4（波一，引其收官记录）、判据 2/5（波二，引 §H 物证）、判据 3（本波 Task 8 走查 + 物证目录路径）、判据 6（词表文件路径）。
- `CHANGELOG.md` 加一行（一合并一行，写在合并 commit 信息可见处）。
- **末波无下一波骨架**（多波承接规则的末波出口）：不立新骨架，验收节即收官记录。

- [ ] **Step 5: Commit**

```bash
git add doc-final/modules/v1-governance.md src/modules/audit-logging/constants/audit-actions.constant.ts doc-final/demo/script.md doc-final/demo/data.md doc-final/BACKLOG.md doc-final/CHANGELOG.md doc-final/superpowers/specs/2026-09-15-act7-audit-campaign-charter.md
git commit -m "docs(审计波三): 收官记账——名册数字改真/§6检索口径按OR语义重写/剧本第七幕升级深链版/BACKLOG销账7条/总纲六判据验收节"
```

---

## 合并后清单（主工作树执行，不在 worktree 里做）

1. 按 `superpowers:finishing-a-development-branch` 合并（先并进分支再主树快进，判例在案）；合并后清 worktree + 分支
2. 重启后端 + `npm run db:base:sync`（本波 RBAC 预计零变化，照惯例跑一遍不亏）
3. **战役归档**：波一/二/三 spec + plan + 总纲移 `doc-final/archive/`（总纲活到末波，本波收官后随迁）
4. 词表 `2026-09-16-audit-actions-catalog-full.md` 交业主（lark/ 下业主自取，9-15 旧版去留业主定）
5. 主栈抽查：审计页深链任点一条（合并后的树为准，判例：终验以合并后的树为准）

## 交付清单命中表（`rules/delivery-checklist.md` 逐行对号，任务收尾照此验）

| 清单行 | 命中? | 落在哪 |
|---|---|---|
| 任何持久状态变化→写审计 | 不触发 | 本波零新写点；审计页查询留痕走既有 AUDIT_LOG_QUERIED |
| 新增审计动作码 | 不触发 | 零新码 |
| 新状态/新结局 | 不触发 | 不动状态机 |
| 动了钱 | 不触发 | ⑦ 不跑 |
| maker-checker / 新审批策略 / 新权限组 / 新 admin 端点 | 不触发 | 全复用既有端点与权限（RBAC catalog 零改动） |
| 新增业务动作→前端有入口 | ✓ | Task 4 六页按钮、Task 3 View journey、Task 5 View full trail |
| 退役业务动作→前端入口同步删 | ✓ | Task 5 旧 Audit Log 栏（死表读面）连组件整段删 |
| 改了交易三域任一→问另外两域 | ✓ | Task 4 三域订单详情**同批对称接入**，无单域裸奔 |
| 新字段/新状态到客户面 | 不触发 | client-web 零改动（tipping-off 面不变） |
| 涉及金额 | 不触发 | — |
| 对外识别用业务键 | ✓ | 深链参数/映射/资金单栏全business no（Task 2-6） |
| 新事件 | 不触发 | — |
| 改 schema | 不触发 | ⑧ 不跑 |
| 改页面/种子→同步 demo 两文档 | ✓ | Task 9 Step 2（script.md 深链版 + data.md 扫查） |
| 改了前端→preview 截图 | ✓（永不豁免①） | Task 8 Step 4 十一张 |
| 多波中的一波→承接写进下一波 | ✓（末波变体） | Task 9 Step 4 战役验收节代替骨架（无下一波） |
| 每轮收尾→分层收口+CHANGELOG+BACKLOG | ✓ | Task 9 Step 3/4 |
| 永不豁免② verify:coa | 不触发 | 未动钱（demo:all 断言仍在 ⑥ 里跑） |
