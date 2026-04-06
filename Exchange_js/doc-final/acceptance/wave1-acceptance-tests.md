# Wave 1 验收测试文档

**文档编号**: ACC-WAVE1-001
**版本**: 1.0
**日期**: 2026-04-06
**适用系统**: Exchange_js（Wave 1 功能集）
**文档用途**: 人工测试执行手册，面向无代码访问权限的 QA 测试人员

---

## 环境信息

| 项目 | 值 |
|------|-----|
| 后端 API 地址 | http://localhost:3000 |
| 管理后台地址 | http://localhost:3001 |
| 默认密码 | `123456` |

### 种子账号

| 邮箱 | 角色 | 角色代码 |
|------|------|----------|
| admin@fiatx.com | 超级管理员 | SUPER_ADMIN |
| tech_admin@fiatx.com | 技术负责人 | TECH_OFFICER |
| ciso@fiatx.com | 首席信息安全官 | CISO |
| dpo@fiatx.com | 数据保护官 | DPO |
| mlro@fiatx.com | 洗钱报告官 | MLRO |
| compliance_lead@fiatx.com | 合规专员 | COMPLIANCE_OFFICER |
| sm@fiatx.com | 高级管理人员 | SENIOR_MANAGEMENT_OFFICER |
| ops_officer@fiatx.com | 运营专员 | OPS_OFFICER |

---

## 测试矩阵

| 测试编号 | 测试场景 | 关键角色 | 预计时长 |
|----------|----------|----------|----------|
| TC-01 | 创建管理员账号（Admin Member Provisioning） | TECH_OFFICER（申请）、CISO（审批） | 20 分钟 |
| TC-02 | 更改管理员角色绑定（Admin Role Binding Change） | TECH_OFFICER（申请）、CISO（审批） | 15 分钟 |
| TC-03 | 导出审计证据包（Audit Evidence Export） | COMPLIANCE_OFFICER（申请）、DPO（审批） | 20 分钟 |
| TC-04 | 删除管理员账号（Delete Admin User） | TECH_OFFICER（申请）、CISO（审批）、SUPER_ADMIN（执行） | 25 分钟 |
| TC-05 | 删除变更工单（Delete Change Ticket） | TECH_OFFICER（申请）、DPO/CISO（审批）、非创建人（执行） | 20 分钟 |
| TC-06 | 删除审计证据包（Delete Audit Evidence Package） | TECH_OFFICER/COMPLIANCE_OFFICER（申请）、DPO/CISO（审批）、非创建人（执行） | 20 分钟 |
| TC-N01 | 验证 maker-checker SoD（创建人不得审批） | 任意账号 | 5 分钟 |
| TC-N02 | 验证 checker 角色限制（无权角色不得审批） | OPS_OFFICER | 5 分钟 |
| TC-N03 | 验证重复审批单保护（已有 PENDING 时不得再次提交） | TECH_OFFICER | 5 分钟 |
| TC-N04 | 验证 INACTIVE 账号无法登录 | 新建未激活账号 | 5 分钟 |

**合计预计时长**: 约 2.5 小时

---

## 通用约定

1. **账号切换**: 每次切换账号时，必须先完整登出当前账号，再以新账号登录，避免会话混用。
2. **状态记录**: 每个步骤完成后，请截图记录页面状态并与期望结果对照。
3. **ticketNo / approvalNo / requestNo**: 系统自动生成，格式说明见各用例。测试人员需在步骤间手动记录这些编号，以便在后续步骤中查找对应单据。
4. **Audit Center 查询**: 所有审计事件均可在 管理后台 → Audit Center 通过 ticketNo、approvalNo 或 requestNo 进行过滤查看。

---

## TC-01: 创建管理员账号（Admin Member Provisioning）

**测试编号**: TC-01
**优先级**: P0（核心流程）
**预计时长**: 20 分钟

### 测试目标

验证 TECH_OFFICER 可以通过变更工单流程创建新管理员账号，CISO 审批后系统自动创建用户并生成邀请链接。

### 前置条件

- [ ] 系统后端（`http://localhost:3000`）和管理后台（`http://localhost:3001`）已正常启动
- [ ] 数据库种子数据已导入（所有种子账号可正常登录）
- [ ] 邮箱 `new.compliance@fiatx.com` 在系统中**不存在**（如已存在，请先通过删除流程清除，或更换一个未使用的测试邮箱）
- [ ] 当前以 `tech_admin@fiatx.com`（角色：TECH_OFFICER，密码：`123456`）身份登录管理后台

---

### 测试步骤

#### Step 1: 创建变更工单

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 在管理后台左侧导航中，点击 **Control Gates**，展开子菜单，点击 **Change Tickets**。
2. 点击页面右上角的 **Create** 按钮，进入新建工单页面。
3. 按以下内容填写表单字段：

   | 字段 | 填写值 |
   |------|--------|
   | Change Type（变更类型） | `ADMIN_ACCESS_CHANGE` |
   | Change Reason（变更原因） | `新增合规专员账号` |
   | Scope Summary（范围说明） | `新增合规专员` |
   | Test Evidence Ref（测试依据） | `N/A` |
   | Rollback Plan Ref（回滚方案） | `删除对应账号` |

4. 在 **Binding Snapshot JSON** 字段中，填入以下 JSON 内容：

   ```json
   {
     "intent": "ADMIN_MEMBER_PROVISIONING",
     "email": "new.compliance@fiatx.com",
     "roleCodes": ["COMPLIANCE_OFFICER"]
   }
   ```

5. 点击 **Submit（提交）** 按钮创建工单。

**期望结果**:
- 页面跳转至工单详情页（或列表页出现新建工单条目）
- 工单状态显示为 **DRAFT**
- 系统已分配工单编号，格式为 `CT-YYYYMMDD-XXXX`（例如 `CT-20260406-0001`）
- 记录该工单编号，后续步骤将使用

> **记录**: ticketNo = ______________________

---

#### Step 2: 提交审批

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 在工单详情页，找到并点击 **Submit for Approval（提交审批）** 按钮。
2. 如弹出确认对话框，点击 **确认**。

**期望结果**:
- 工单状态变更为 **PENDING_APPROVAL**
- 页面显示关联审批单编号，格式为 `APR-YYYYMMDD-XXXX`
- 记录该审批单编号

> **记录**: approvalNo = ______________________

3. 导航至 **Audit Center**，在搜索框输入上方记录的 ticketNo 进行查询。

**期望结果**:
- 审计中心可查到事件类型为 **`CHANGE_TICKET_SUBMITTED`** 的记录
- 记录中显示的 ticketNo 与步骤 1 记录一致

---

#### Step 3: 切换至 CISO 账号执行审批

**操作人员**: CISO（ciso@fiatx.com）

1. 点击右上角用户头像，选择 **登出（Logout）**，确保完全退出当前会话。
2. 在登录页输入：
   - 邮箱：`ciso@fiatx.com`
   - 密码：`123456`
   - 点击 **登录**。
3. 导航至 **Control Gates → Approvals（审批管理）**。
4. 在列表中找到步骤 2 记录的 approvalNo，或通过筛选条件（状态：`PENDING`，类型：`CHANGE_TICKET_APPROVAL`）定位该审批单。
5. 点击该审批单，进入详情页。
6. 点击 **Approve（批准）** 按钮。
7. 如弹出确认对话框或要求填写审批意见，填入意见 `同意新增合规专员账号` 后点击 **确认**。

**期望结果**:
- 审批单状态变更为 **APPROVED**
- 返回查看关联变更工单（导航至 Change Tickets，搜索步骤 1 的 ticketNo），工单状态变更为 **READY**
- 在 Audit Center 搜索 ticketNo，可查到新增事件类型 **`APPROVAL_APPROVED`** 的记录

---

#### Step 4: 切换回 TECH_OFFICER 执行 Consume

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 登出 CISO 账号，以 `tech_admin@fiatx.com` / `123456` 重新登录。
2. 导航至 **Control Gates → Change Tickets**，找到步骤 1 的工单（ticketNo），进入详情页。
3. 确认工单状态已为 **READY**。
4. 点击 **Consume（执行）** 按钮。
5. 如弹出确认对话框，点击 **确认**。

**期望结果**:
- 工单状态变更为 **DONE**
- 工单详情页的 **Result Note** 字段中包含邀请链接相关信息（如邀请 token 或链接 URL）

5. 导航至 **Platform Members（平台成员）** 列表。
6. 在搜索框中输入 `new.compliance@fiatx.com` 进行搜索。

**期望结果**:
- 列表中出现 `new.compliance@fiatx.com` 的用户记录
- 该用户状态为 **INACTIVE**（账号已创建但尚未激活）
- 用户已绑定 **COMPLIANCE_OFFICER** 角色

7. 在 Audit Center 搜索 ticketNo。

**期望结果**:
- 可查到事件类型 **`CHANGE_TICKET_CONSUMED`** 的记录

---

### 验证检查清单

| 验证点 | 验证方法 | 通过/失败 | 备注 |
|--------|----------|-----------|------|
| 工单最终状态为 DONE | 工单详情页状态字段 | | |
| Platform Members 列表出现新用户 | 以邮箱搜索 new.compliance@fiatx.com | | |
| 新用户状态为 INACTIVE | 用户详情页状态字段 | | |
| 新用户已绑定 COMPLIANCE_OFFICER 角色 | 用户详情页角色列表 | | |
| Audit Center 存在 CHANGE_TICKET_SUBMITTED 事件 | 按 ticketNo 查询 | | |
| Audit Center 存在 APPROVAL_APPROVED 事件 | 按 ticketNo 查询 | | |
| Audit Center 存在 CHANGE_TICKET_CONSUMED 事件 | 按 ticketNo 查询 | | |
| 工单编号格式符合 CT-YYYYMMDD-XXXX | 目视检查 | | |
| 审批单编号格式符合 APR-YYYYMMDD-XXXX | 目视检查 | | |

---

## TC-02: 更改管理员角色绑定（Admin Role Binding Change）

**测试编号**: TC-02
**优先级**: P0（核心流程）
**预计时长**: 15 分钟

### 测试目标

验证可以通过变更工单修改已有管理员的角色绑定，CISO 审批后角色变更自动生效。

### 前置条件

- [ ] 系统正常运行，种子账号可登录
- [ ] `ops_officer@fiatx.com` 账号存在，当前仅绑定 **OPS_OFFICER** 角色
- [ ] 已知 `ops_officer@fiatx.com` 在系统中的 `userId`（可在 Platform Members 详情页查看）和 `userNo`（格式如 `ADMIN-OPS-XXXX`）
- [ ] 当前以 `tech_admin@fiatx.com`（TECH_OFFICER，密码：`123456`）身份登录

> **准备步骤**: 登录后，先导航至 **Platform Members**，搜索 `ops_officer@fiatx.com`，记录该用户的 userId 和 userNo。
>
> **记录**: userId = ______________________ userNo = ______________________

---

### 测试步骤

#### Step 1: 创建角色变更工单

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 导航至 **Control Gates → Change Tickets → Create**。
2. 填写表单：

   | 字段 | 填写值 |
   |------|--------|
   | Change Type | `ADMIN_ACCESS_CHANGE` |
   | Change Reason | `为运营专员增加合规角色权限` |
   | Scope Summary | `ops_officer 角色扩展` |
   | Test Evidence Ref | `N/A` |
   | Rollback Plan Ref | `恢复为仅 OPS_OFFICER 角色` |

3. 在 **Binding Snapshot JSON** 填入（将 `<userId>` 和 `<userNo>` 替换为前置步骤中记录的实际值）：

   ```json
   {
     "intent": "ADMIN_ROLE_BINDING_CHANGE",
     "targetUserId": "<userId>",
     "targetUserNo": "<userNo>",
     "roleCodes": ["OPS_OFFICER", "COMPLIANCE_OFFICER"],
     "changeMode": "REPLACE"
   }
   ```

4. 点击 **Submit** 创建工单。

**期望结果**:
- 工单创建成功，状态 **DRAFT**
- 工单编号已生成

> **记录**: ticketNo = ______________________

---

#### Step 2: 提交审批

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 在工单详情页点击 **Submit for Approval**。

**期望结果**:
- 工单状态变更为 **PENDING_APPROVAL**
- 关联审批单已生成，状态 **PENDING**

> **记录**: approvalNo = ______________________

---

#### Step 3: CISO 审批

**操作人员**: CISO（ciso@fiatx.com）

1. 登出，以 `ciso@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Approvals**，找到上方记录的 approvalNo。
3. 进入审批详情，点击 **Approve**，填写意见 `同意扩展运营专员角色权限`，确认提交。

**期望结果**:
- 审批单状态变更为 **APPROVED**
- 关联变更工单状态变更为 **READY**

---

#### Step 4: 执行 Consume

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 登出，以 `tech_admin@fiatx.com` 重新登录。
2. 找到该变更工单，确认状态为 **READY**，点击 **Consume**，确认执行。

**期望结果**:
- 工单状态变更为 **DONE**

3. 导航至 **Platform Members**，搜索 `ops_officer@fiatx.com`，点击进入用户详情页。

**期望结果**:
- 角色列表中同时包含 **OPS_OFFICER** 和 **COMPLIANCE_OFFICER** 两个角色
- （不包含其他多余角色）

4. 在 Audit Center 搜索 ticketNo。

**期望结果**:
- 可查到 **`USER_ROLE_BINDING_UPDATED`** 类型的审计事件

---

### 验证检查清单

| 验证点 | 验证方法 | 通过/失败 | 备注 |
|--------|----------|-----------|------|
| 工单最终状态为 DONE | 工单详情页 | | |
| 目标用户角色列表包含 OPS_OFFICER | Platform Members 详情页 | | |
| 目标用户角色列表包含 COMPLIANCE_OFFICER | Platform Members 详情页 | | |
| Audit Center 存在 USER_ROLE_BINDING_UPDATED 事件 | 按 ticketNo 查询 | | |
| 完整事件链可查（CREATED→SUBMITTED→APPROVED→CONSUMED） | Audit Center 过滤 | | |

---

## TC-03: 导出审计证据包（Audit Evidence Export）

**测试编号**: TC-03
**优先级**: P1（重要流程）
**预计时长**: 20 分钟

### 测试目标

验证 COMPLIANCE_OFFICER 可以请求导出审计证据包，DPO 审批后系统自动生成证据包，并可成功下载。

### 前置条件

- [ ] 系统正常运行
- [ ] 系统中已有若干审计事件（建议在执行 TC-01 后进行本测试，以确保审计数据存在）
- [ ] 当前以 `compliance_lead@fiatx.com`（COMPLIANCE_OFFICER，密码：`123456`）身份登录

---

### 测试步骤

#### Step 1: 创建证据包导出请求

**操作人员**: COMPLIANCE_OFFICER（compliance_lead@fiatx.com）

1. 导航至 **Audit Center → Evidence Packages**。
2. 点击 **Request Export（申请导出）** 按钮。
3. 在导出请求表单中填写筛选条件：

   | 字段 | 填写值 |
   |------|--------|
   | 日期范围（Date Range） | 最近 7 天（起始日期选 7 天前，结束日期选今天） |
   | 导出原因（Export Reason） | `合规定期审查，需要近期操作记录` |

4. 如有事件类型多选框，选择全部事件类型（或保持默认）。
5. 点击 **Submit** 提交导出申请。

**期望结果**:
- 导出申请创建成功
- 系统自动生成关联审批单，类型为 **`AUDIT_EVIDENCE_EXPORT_APPROVAL`**，状态为 **PENDING**
- 证据包条目在列表中出现，状态为 **PENDING**（等待审批）

> **记录**: 证据包编号（packageNo）= ______________________ 审批单编号（approvalNo）= ______________________

---

#### Step 2: 切换至 DPO 账号执行审批

**操作人员**: DPO（dpo@fiatx.com）

1. 登出，以 `dpo@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Approvals**。
3. 通过以下方式找到刚才创建的审批单：
   - 筛选条件：类型 = `AUDIT_EVIDENCE_EXPORT_APPROVAL`，状态 = `PENDING`
   - 或直接搜索步骤 1 记录的 approvalNo
4. 进入审批详情页，点击 **Approve**，填写意见 `同意导出合规审查证据包`，确认提交。

**期望结果**:
- 审批单状态变更为 **APPROVED**
- 审批单的 `executionStatus` 字段变更为 **EXECUTED**（系统在审批通过后自动执行了证据包生成）
- 返回 Audit Center → Evidence Packages，找到步骤 1 的证据包条目，状态变更为 **READY**

---

#### Step 3: 下载证据包

**操作人员**: COMPLIANCE_OFFICER（compliance_lead@fiatx.com）

1. 登出，以 `compliance_lead@fiatx.com` 重新登录。
2. 导航至 **Audit Center → Evidence Packages**。
3. 找到步骤 1 中记录的证据包（状态应为 **READY**）。
4. 点击 **Download（下载）** 按钮。

**期望结果**:
- 浏览器触发文件下载
- 下载的文件格式正确（如 `.zip` 或 `.json`），文件大小大于 0 字节

5. 下载完成后，在 Audit Center 搜索 packageNo。

**期望结果**:
- 可查到事件类型 **`AUDIT_EVIDENCE_PACKAGE_DOWNLOADED`** 的审计记录

---

### 验证检查清单

| 验证点 | 验证方法 | 通过/失败 | 备注 |
|--------|----------|-----------|------|
| 证据包状态为 READY | Evidence Packages 列表 | | |
| 审批单 executionStatus = EXECUTED | 审批单详情页 | | |
| 文件可成功下载（非空文件） | 实际下载并检查文件大小 | | |
| Audit Center 存在 AUDIT_EVIDENCE_EXPORT_REQUESTED 事件 | 按 packageNo 查询 | | |
| Audit Center 存在 APPROVAL_APPROVED 事件 | 按 approvalNo 查询 | | |
| Audit Center 存在 AUDIT_EVIDENCE_PACKAGE_EXPORTED 事件 | 按 packageNo 查询 | | |
| Audit Center 存在 AUDIT_EVIDENCE_PACKAGE_DOWNLOADED 事件 | 按 packageNo 查询 | | |

---

## TC-04: 删除管理员账号（Delete Admin User）

**测试编号**: TC-04
**优先级**: P0（SoD 规则验证）
**预计时长**: 25 分钟

### 测试目标

验证删除管理员账号的完整申请工作流，并重点验证**职责分离（SoD）规则**：创建删除申请的人员不得执行 consume 操作。

### 前置条件

- [ ] `new.compliance@fiatx.com` 账号已存在于系统中（即 TC-01 已成功执行；若未执行 TC-01，请先完成之）
- [ ] 已知该账号的 `userNo`（在 Platform Members 详情页可查）
- [ ] 当前以 `tech_admin@fiatx.com`（TECH_OFFICER，密码：`123456`）身份登录

> **准备步骤**: 登录后导航至 Platform Members，搜索 `new.compliance@fiatx.com`，记录其 userNo。
>
> **记录**: userNo = ______________________

---

### 测试步骤

#### Step 1: 创建删除申请

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 导航至 **Control Gates → Delete Requests（删除申请）**。
2. 点击 **Create（新建）** 按钮。
3. 填写表单：

   | 字段 | 填写值 |
   |------|--------|
   | Target Type（目标类型） | `ADMIN_USER` |
   | Target No（目标编号） | 前置步骤中记录的 `userNo` |
   | Delete Reason（删除原因） | `账号已不需要，申请注销` |

4. 点击 **Submit** 创建申请。

**期望结果**:
- 申请创建成功，状态为 **DRAFT**
- 系统生成申请编号，格式为 `DR-YYYYMMDD-XXXX`
- 申请的 `targetSnapshotJson` 字段已自动填充目标用户的快照数据（包含邮箱、角色等信息）

> **记录**: requestNo = ______________________

---

#### Step 2: 提交审批

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 在申请详情页点击 **Submit for Approval**。

**期望结果**:
- 申请状态变更为 **PENDING_APPROVAL**
- 关联审批单生成，类型为 **`DELETE_REQUEST_APPROVAL`**，状态 **PENDING**

> **记录**: approvalNo = ______________________

---

#### Step 3: CISO 审批通过

**操作人员**: CISO（ciso@fiatx.com）

1. 登出，以 `ciso@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Approvals**，找到上方 approvalNo 对应的审批单（类型：`DELETE_REQUEST_APPROVAL`）。
3. 进入详情，点击 **Approve**，填写审批意见，确认提交。

**期望结果**:
- 审批单状态变更为 **APPROVED**
- 关联删除申请状态变更为 **READY**

---

#### Step 4: 验证 SoD — 创建人不得执行 Consume（负面测试）

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）——即申请创建人

1. 登出，以 `tech_admin@fiatx.com` 重新登录。
2. 导航至 **Control Gates → Delete Requests**，找到步骤 1 的申请（状态 **READY**）。
3. 点击 **Consume（执行删除）** 按钮，并确认。

**期望结果**:
- 系统**拒绝**执行，页面显示错误提示
- 错误信息应包含类似"创建人不得执行此操作"或"SoD 违规"或 HTTP 403 的提示
- 申请状态**保持 READY 不变**，目标用户账号**仍然存在**

> **重要**: 此步骤是安全控制验证，如系统允许执行则为**严重缺陷（P0 Bug）**，需立即上报。

---

#### Step 5: 以不同账号执行 Consume

**操作人员**: SUPER_ADMIN（admin@fiatx.com）

1. 登出，以 `admin@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Delete Requests**，找到步骤 1 的申请。
3. 点击 **Consume**，确认执行。

**期望结果**:
- 申请状态变更为 **DONE**
- 导航至 **Platform Members**，搜索 `new.compliance@fiatx.com`：用户记录**不再出现在列表中**

4. 验证账号已注销（登录测试）：
   - 在一个新的浏览器私人/无痕窗口中，访问 `http://localhost:3001`
   - 尝试以 `new.compliance@fiatx.com` / `123456` 登录

**期望结果**:
- 登录失败，系统返回错误提示（如"账号不存在"或"账号已注销"）

---

### 验证检查清单

| 验证点 | 验证方法 | 通过/失败 | 备注 |
|--------|----------|-----------|------|
| 创建人执行 consume 被系统拒绝（SoD） | 步骤 4 实际操作 | | |
| 拒绝后申请状态仍为 READY | 列表页状态字段 | | |
| 非创建人执行 consume 成功（状态变 DONE） | 申请详情页状态字段 | | |
| 目标用户从 Platform Members 列表消失 | 以邮箱搜索 | | |
| 目标用户登录请求被拒绝 | 无痕窗口实际登录测试 | | |
| Audit Center 存在完整事件链 | 按 requestNo 查询 | | |

---

## TC-05: 删除变更工单（Delete Change Ticket）

**测试编号**: TC-05
**优先级**: P1
**预计时长**: 20 分钟

### 测试目标

验证仅处于**终态（DONE 或 CANCELLED）**的变更工单可以发起删除申请，正在进行中的工单不允许删除；并验证删除后仍可在删除申请中查看目标工单的历史快照。

### 前置条件

- [ ] 系统中存在至少一个**状态为 DONE** 的变更工单（TC-01 执行完成后即可满足）
- [ ] 系统中存在至少一个**状态为 PENDING_APPROVAL** 的变更工单（若无，可创建一个新工单并提交审批后暂不审批）
- [ ] 已知上述两个工单的 ticketNo
- [ ] 当前以 `tech_admin@fiatx.com`（TECH_OFFICER，密码：`123456`）身份登录

> **记录**:
> - 进行中工单（PENDING_APPROVAL）ticketNo = ______________________
> - 已完成工单（DONE）ticketNo = ______________________

---

### 测试步骤

#### Step 1: 负面测试 — 尝试删除进行中的工单

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 导航至 **Control Gates → Delete Requests → Create**。
2. 填写表单：

   | 字段 | 填写值 |
   |------|--------|
   | Target Type | `CHANGE_TICKET` |
   | Target No | 前置条件中记录的**进行中工单**的 ticketNo（PENDING_APPROVAL 状态） |
   | Delete Reason | `测试删除非终态工单` |

3. 点击 **Submit** 尝试创建删除申请。

**期望结果**:
- 系统**拒绝**创建申请
- 错误提示应包含类似"目标工单未处于终态"或"只有 DONE/CANCELLED 状态的工单可被删除"的说明
- 未生成任何新的删除申请记录

> **注意**: 若系统允许创建，则为缺陷，需上报。

---

#### Step 2: 创建针对 DONE 状态工单的删除申请

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 导航至 **Control Gates → Delete Requests → Create**。
2. 填写表单：

   | 字段 | 填写值 |
   |------|--------|
   | Target Type | `CHANGE_TICKET` |
   | Target No | 前置条件中记录的**已完成工单**的 ticketNo（DONE 状态） |
   | Delete Reason | `归档清理，历史工单软删除` |

3. 点击 **Submit** 创建申请。

**期望结果**:
- 申请创建成功，状态 **DRAFT**
- 申请详情页中，`targetSnapshotJson` 字段已自动填充被删除工单的完整快照数据（包含 changeType、changeReason 等字段）

> **记录**: requestNo = ______________________ 审批单 approvalNo = ______________________（在下一步提交后生成）

---

#### Step 3: 提交审批

**操作人员**: TECH_OFFICER（tech_admin@fiatx.com）

1. 在申请详情页点击 **Submit for Approval**。

**期望结果**:
- 申请状态变更为 **PENDING_APPROVAL**
- 关联审批单生成

> **记录**: approvalNo = ______________________

---

#### Step 4: DPO 或 CISO 审批通过

**操作人员**: DPO（dpo@fiatx.com）或 CISO（ciso@fiatx.com）

1. 登出，以 `dpo@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Approvals**，找到上方 approvalNo 的审批单，点击 **Approve**。

**期望结果**:
- 审批单 APPROVED，删除申请变 **READY**

---

#### Step 5: 非创建人执行 Consume

**操作人员**: 非 TECH_OFFICER 的账号（如 `admin@fiatx.com`）

1. 登出，以 `admin@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Delete Requests**，找到步骤 2 的申请（requestNo），点击 **Consume**，确认执行。

**期望结果**:
- 申请状态变更为 **DONE**
- 导航至 **Control Gates → Change Tickets**，搜索被删除的 ticketNo：该工单**不再出现在列表中**

3. 返回 **Delete Requests** 列表，点击步骤 2 创建的删除申请，进入详情页。

**期望结果**:
- 申请详情页中，`targetSnapshotJson` 字段仍然显示被删除工单的快照数据（数据未被清除）

---

### 验证检查清单

| 验证点 | 验证方法 | 通过/失败 | 备注 |
|--------|----------|-----------|------|
| 非终态工单无法创建删除申请（被拒绝） | 步骤 1 实际操作 | | |
| DONE 状态工单可成功创建删除申请 | 步骤 2 实际操作 | | |
| 执行 consume 后工单从 Change Tickets 列表消失 | 以 ticketNo 搜索 | | |
| Delete Request 详情页仍可查看 targetSnapshotJson 快照 | 步骤 5 实际查看 | | |
| SoD：创建人不得执行 consume（与 TC-04 Step 4 逻辑一致） | 可选验证 | | |

---

## TC-06: 删除审计证据包（Delete Audit Evidence Package）

**测试编号**: TC-06
**优先级**: P1
**预计时长**: 20 分钟

### 测试目标

验证审计证据包的软删除流程，以及证据包被删除后历史审计记录不受影响的保护机制。

### 前置条件

- [ ] 系统中存在一个状态为 **READY** 的证据包（TC-03 执行完成后即可满足）
- [ ] 该证据包**没有**处于 PENDING 状态的关联审批单
- [ ] 已知该证据包的编号（packageNo）
- [ ] 当前以 `compliance_lead@fiatx.com`（COMPLIANCE_OFFICER，密码：`123456`）身份登录

> **记录**: packageNo = ______________________

---

### 测试步骤

#### Step 1: 创建证据包删除申请

**操作人员**: COMPLIANCE_OFFICER（compliance_lead@fiatx.com）

1. 导航至 **Control Gates → Delete Requests → Create**。
2. 填写表单：

   | 字段 | 填写值 |
   |------|--------|
   | Target Type | `AUDIT_EVIDENCE_PACKAGE` |
   | Target No | 前置条件中记录的 packageNo |
   | Delete Reason | `证据包包含部分敏感信息，需撤回并软删除` |

3. 点击 **Submit** 创建申请。

**期望结果**:
- 申请创建成功，状态 **DRAFT**
- `targetSnapshotJson` 已冻结证据包快照

> **记录**: requestNo = ______________________

---

#### Step 2: 提交审批

**操作人员**: COMPLIANCE_OFFICER（compliance_lead@fiatx.com）

1. 点击 **Submit for Approval**。

**期望结果**:
- 申请状态变更为 **PENDING_APPROVAL**
- 关联审批单生成（PENDING）

> **记录**: approvalNo = ______________________

---

#### Step 3: DPO 或 CISO 审批通过

**操作人员**: DPO（dpo@fiatx.com）

1. 登出，以 `dpo@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Approvals**，找到 approvalNo 对应审批单，点击 **Approve**，确认提交。

**期望结果**:
- 审批单 APPROVED，删除申请变 **READY**

---

#### Step 4: 非创建人执行 Consume

**操作人员**: SUPER_ADMIN（admin@fiatx.com）或其他非 compliance_lead 账号

1. 登出，以 `admin@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Delete Requests**，找到 requestNo 对应申请，点击 **Consume**，确认执行。

**期望结果**:
- 申请状态变更为 **DONE**
- 在 Audit Center 中可查到 **`DELETE_REQUEST_CONSUMED`** 类型的审计事件

---

#### Step 5: 验证证据包已不可访问

**操作人员**: COMPLIANCE_OFFICER（compliance_lead@fiatx.com）

1. 登出，以 `compliance_lead@fiatx.com` 重新登录。
2. 导航至 **Audit Center → Evidence Packages**。
3. 搜索已删除的 packageNo。

**期望结果**:
- 证据包**不再出现**在 Evidence Packages 列表中（软删除，前端隐藏）

4. 若记录了该证据包的直接下载链接，尝试在浏览器中直接访问该链接。

**期望结果**:
- 返回 HTTP 404 或页面提示"该证据包已被删除"或"资源不存在"

---

#### Step 6: 验证历史审计记录仍然存在

**操作人员**: COMPLIANCE_OFFICER（compliance_lead@fiatx.com）

1. 在 Audit Center 中，通过 packageNo 进行搜索（不限制事件类型）。

**期望结果**:
- 该证据包的历史审计事件**仍然可查**（如 TC-03 中产生的 `AUDIT_EVIDENCE_EXPORT_REQUESTED`、`AUDIT_EVIDENCE_PACKAGE_EXPORTED` 等事件）
- 软删除仅隐藏证据包本身，**不会删除审计历史记录**

---

### 验证检查清单

| 验证点 | 验证方法 | 通过/失败 | 备注 |
|--------|----------|-----------|------|
| 证据包从 Evidence Packages 列表消失 | 以 packageNo 搜索 | | |
| 直接访问下载链接返回 404 或已删除提示 | 浏览器地址栏访问 | | |
| Audit Center 存在 DELETE_REQUEST_CONSUMED 事件 | 按 requestNo 查询 | | |
| 该证据包的历史审计记录仍然存在（软删除不破坏历史） | 按 packageNo 在 Audit Center 查询 | | |
| SoD：创建人不得执行 consume | 可选验证（参考 TC-04 Step 4） | | |

---

## 通用负面测试

---

### TC-N01: 验证 Maker-Checker SoD（创建人不得审批同一工单）

**测试编号**: TC-N01
**优先级**: P0（安全控制）
**预计时长**: 5 分钟

### 测试目标

验证系统强制执行 Maker-Checker 职责分离原则：创建变更工单的账号不能审批同一工单关联的审批单。

### 前置条件

- [ ] 当前以 `tech_admin@fiatx.com`（TECH_OFFICER）身份登录
- [ ] 已有一个由 `tech_admin@fiatx.com` 创建且处于 **PENDING_APPROVAL** 状态的变更工单（及关联的 PENDING 审批单）
  - 若无，可新建工单并提交审批，不要让 CISO 审批，保留 PENDING 状态

> **记录**: approvalNo（PENDING 状态）= ______________________

### 测试步骤

1. 以创建该工单的账号（`tech_admin@fiatx.com`）登录。
2. 导航至 **Control Gates → Approvals**，找到上方 approvalNo 对应的审批单（状态 PENDING）。
3. 进入审批单详情页，尝试点击 **Approve** 按钮执行审批。

**期望结果**:
- 系统**拒绝**审批操作
- 页面显示错误提示，内容应包含"SoD 违规"、"创建人不得审批"、"Maker-Checker 冲突"或 HTTP **403 Forbidden** 的提示
- 审批单状态**保持 PENDING 不变**

> **注意**: 若系统允许自我审批，则为**严重安全缺陷（P0）**，需立即上报。

### 验证检查清单

| 验证点 | 通过/失败 | 备注 |
|--------|-----------|------|
| 系统返回拒绝响应（403 或错误提示） | | |
| 审批单状态保持 PENDING | | |

---

### TC-N02: 验证 Checker 角色限制（无权角色不得审批）

**测试编号**: TC-N02
**优先级**: P0（安全控制）
**预计时长**: 5 分钟

### 测试目标

验证仅具备审批权限的特定角色（如 CISO）才能审批变更工单审批单，其他角色（如 OPS_OFFICER）尝试审批时应被拒绝。

### 前置条件

- [ ] 系统中存在一个处于 **PENDING** 状态的变更工单审批单（类型：`CHANGE_TICKET_APPROVAL`）
- [ ] `ops_officer@fiatx.com` 账号仅有 **OPS_OFFICER** 角色（若 TC-02 已执行，注意该账号可能已有额外角色；需确认当前角色状态）

> **记录**: approvalNo（PENDING 的 CHANGE_TICKET_APPROVAL 类型）= ______________________

### 测试步骤

1. 登出当前账号，以 `ops_officer@fiatx.com` / `123456` 登录。
2. 导航至 **Control Gates → Approvals**，找到上方记录的审批单。
3. 进入审批单详情页，尝试点击 **Approve** 执行审批。

**期望结果**:
- 系统**拒绝**审批操作
- 页面显示错误提示，内容应包含"无权审批"、"角色不符合要求"或 HTTP **403 Forbidden**
- 审批单状态**保持 PENDING 不变**

### 验证检查清单

| 验证点 | 通过/失败 | 备注 |
|--------|-----------|------|
| OPS_OFFICER 尝试审批 CHANGE_TICKET_APPROVAL 被拒绝（403） | | |
| 审批单状态保持 PENDING | | |

---

### TC-N03: 验证重复审批单保护（禁止重复提交）

**测试编号**: TC-N03
**优先级**: P1
**预计时长**: 5 分钟

### 测试目标

验证同一个变更工单在已有 PENDING 审批单时，不允许再次提交创建新的审批单，防止重复审批。

### 前置条件

- [ ] 系统中存在一个处于 **PENDING_APPROVAL** 状态的变更工单（即已有一个关联的 PENDING 审批单）
- [ ] 当前以 `tech_admin@fiatx.com`（TECH_OFFICER）身份登录

> **记录**: 已处于 PENDING_APPROVAL 的 ticketNo = ______________________

### 测试步骤

1. 导航至 **Control Gates → Change Tickets**，找到上方记录的工单（状态：**PENDING_APPROVAL**）。
2. 进入工单详情页，尝试再次点击 **Submit for Approval（提交审批）** 按钮。
   - 若按钮已被禁用（灰色不可点击），请记录截图，此为正常前端保护行为，同时尝试通过 API 直接调用验证后端是否同样拒绝（可选步骤）。
   - 若按钮仍可点击，点击后观察响应。

**期望结果**:
- 系统**拒绝**创建新审批单
- 错误提示应包含"已有待审批的审批单"、"重复提交"或 HTTP **409 Conflict**
- 审批单数量**不增加**（仍只有一个 PENDING 的审批单）

### 验证检查清单

| 验证点 | 通过/失败 | 备注 |
|--------|-----------|------|
| 重复提交被拒绝（按钮禁用或返回 409） | | |
| PENDING 审批单数量保持为 1（不新增） | | |

---

### TC-N04: 验证 INACTIVE 账号无法登录

**测试编号**: TC-N04
**优先级**: P0（安全控制）
**预计时长**: 5 分钟

### 测试目标

验证通过变更工单创建的新账号（状态 INACTIVE，尚未完成邀请激活流程）无法直接登录系统。

### 前置条件

- [ ] TC-01 已成功执行，`new.compliance@fiatx.com` 账号存在于系统中，状态为 **INACTIVE**
- [ ] 该账号尚未通过邀请链接完成激活（即未设置过密码）

### 测试步骤

1. 打开一个新的浏览器**无痕/私密**窗口（确保无已有会话）。
2. 访问管理后台登录页：`http://localhost:3001`。
3. 在登录表单中输入：
   - 邮箱：`new.compliance@fiatx.com`
   - 密码：`123456`（使用系统默认密码尝试）
4. 点击 **登录** 按钮。

**期望结果**:
- 登录**失败**
- 错误提示应包含以下之一：
  - "账号未激活"
  - "邮箱或密码错误"（安全起见，系统可能不明确区分未激活和密码错误）
  - HTTP **401 Unauthorized** 或 **403 Forbidden**
- 用户**无法进入**管理后台的任何页面

5. 再次尝试，使用一个随机密码（如 `wrongpassword`），确认同样被拒绝。

**期望结果**:
- 同样被拒绝登录（确保不是因为密码偶然正确）

### 验证检查清单

| 验证点 | 通过/失败 | 备注 |
|--------|-----------|------|
| INACTIVE 账号使用默认密码登录被拒绝 | | |
| INACTIVE 账号使用错误密码登录被拒绝 | | |
| 用户无法访问后台任何页面 | | |

---

## 附录

### 附录 A: 常见问题排查

| 问题现象 | 可能原因 | 处理建议 |
|----------|----------|----------|
| 工单状态一直停留在 DRAFT，点击提交无反应 | 表单字段验证未通过或 bindingSnapshotJson 格式错误 | 检查 JSON 格式，确保双引号无多余空格；打开浏览器开发者工具查看 Network 请求错误信息 |
| Approvals 页面找不到新生成的审批单 | 筛选条件过滤了部分记录 | 清除所有筛选条件，或直接使用 approvalNo 搜索 |
| 执行 consume 后工单仍显示 READY | 浏览器缓存未刷新 | 按 F5 或 Ctrl+Shift+R 强制刷新页面 |
| 下载证据包时无任何反应 | 浏览器阻止了弹窗/下载 | 检查浏览器地址栏是否有弹窗被阻止的提示，点击允许 |
| Audit Center 搜索无结果 | 搜索字段填写错误（注意大小写）或时间范围过窄 | 确认 ticketNo/approvalNo 等编号精确无误；适当扩大时间范围 |

### 附录 B: 工单/申请状态流转图

```
变更工单（Change Ticket）:
  DRAFT → PENDING_APPROVAL → READY → DONE
                          ↘ REJECTED（审批拒绝）

删除申请（Delete Request）:
  DRAFT → PENDING_APPROVAL → READY → DONE
                          ↘ REJECTED

审批单（Approval）:
  PENDING → APPROVED
          ↘ REJECTED
```

### 附录 C: 关键名词对照

| 中文 | 英文 / 系统内显示名称 |
|------|----------------------|
| 变更工单 | Change Ticket |
| 删除申请 | Delete Request |
| 审批单 | Approval |
| 平台成员 | Platform Members |
| 审计中心 | Audit Center |
| 证据包 | Evidence Package |
| 职责分离 | SoD（Separation of Duties） |
| 执行 / 消费工单 | Consume |
| 终态 | Terminal State（DONE 或 CANCELLED） |
| 快照 | Snapshot（创建时冻结的数据副本） |

---

*文档结束 — ACC-WAVE1-001 v1.0*
