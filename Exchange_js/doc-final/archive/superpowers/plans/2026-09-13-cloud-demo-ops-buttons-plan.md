# 云端演示自助还原按钮（Demo Ops 面板）· Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin 管理台加一个 Simulation 门控的 Demo Data 面板，云端同事自助「重铺数据」（进程自退 → systemd 全量重铺）与「重摆对账场景」（子进程跑 recon:demo:break）。

**Architecture:** 后端新增 `src/modules/demo-ops/` 三文件（service / controller / module），module 照 `DepositDemoModule` 的 `SUMSUB_MOCK_MODE` 先例用 `DEMO_OPS=1` 门控 controller 注册——本地路由压根不存在；前端 `DemoOpsPanel` 弹层 + `DashboardLayout` 顶栏入口（探测 `/demo-ops/status` 可达才显示）。重铺零编排：写状态文件后 `process.exit(1)`，systemd `Restart=on-failure` + demo-run.sh 守护自动重启并从零重铺。

**Tech Stack:** NestJS（现有）｜ node:child_process spawn ｜ React + Tailwind（adm-* tokens，现有）｜ 无新依赖。

**Spec:** `doc-final/superpowers/specs/2026-09-13-cloud-demo-ops-buttons-design.md`（含 2026-09-13 登记条勘误）

## Global Constraints

- 环境变量名：`DEMO_OPS`（值 `1` 才开门）、`DEMO_STATUS_PATH`（云端 `/opt/exchange-demo/run/status`）。只写进 `deploy/demo.env.template`，**不写** `.env.example` / 本地栈脚本。
- 权限口径（spec §3 勘误后）：**不进 rbac.catalog.ts、不挂 AdminPermissionGuard**。两个 POST 只挂 `AuthGuard('jwt')`；`GET /demo-ops/status` 无任何守卫（免登录，重铺期间轮询要跨越登录态）。
- 前端文案一律英文（仓库管理台惯例）；status 文件原文（含中文步骤名）当数据原样展示不翻译。
- 禁做（总纲 §2 + spec §0）：并发锁 / 防抖 / 去重（双击防护只靠前端按钮 disabled 状态）、失败自动补救、审计留痕、本地降级形态。
- 路径别名：demo-ops 模块内部用相对导入（同仓惯例）；**禁止 `src/` 绝对导入**（tsc 过 dist 炸的旧坑）。
- 每任务收尾跑随手闸：`npx tsc --noEmit -p tsconfig.json`（后端任务）；前端任务另加 `cd admin-web && npx tsc -b --noEmit`。jest 只跑 `src/modules/demo-ops`。
- 执行环境：worktree 隔离（`.claude/worktrees/demo-ops-buttons/`，用 superpowers:using-git-worktrees 建）；jest 必须在 worktree 的 `Exchange_js/` 根下跑。
- 本机 shell 默认 node18：每条 npx/npm 命令前置 nvm20 PATH（`export PATH="$HOME/.nvm/versions/node/v20"*/bin:"$PATH"`）；判绿不走管道吞码。
- 派 subagent 模型：任务执行 → sonnet；终审 → 主会话。

---

### Task 1: DemoOpsService（状态读取 / 重铺自退 / recon-break 子进程）

**Files:**
- Create: `src/modules/demo-ops/demo-ops.service.ts`
- Test: `src/modules/demo-ops/demo-ops.service.spec.ts`

**Interfaces:**
- Consumes: 无（仅 node 内置 fs / child_process）
- Produces（Task 2 的 controller 依赖）：
  - `readStatus(): { boot: string; reconBreak: { state: 'idle'|'running'|'done'|'fail'; tail: string[]; finishedAt: string|null } }`
  - `requestReset(): { accepted: true }`
  - `startReconBreak(): { accepted: true }`

- [ ] **Step 1: 写失败测试**

```ts
// src/modules/demo-ops/demo-ops.service.spec.ts
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const spawnMock = jest.fn();
jest.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { DemoOpsService } from './demo-ops.service';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe('DemoOpsService', () => {
  // ⚠️ 环境变量恢复用「显式赋空串」而非 delete：@prisma/client 的 runtime 自带
  // dotenv.config()（不覆盖已存在 key），delete 掉的 key 会被 worktree 根 .env
  // 里的值悄悄填回（本地验收时 .env 恰好会写 DEMO_OPS=1）——deposit-demo.module.spec.ts
  // 文件头的同一个坑。
  const ORIGINAL_STATUS_PATH = process.env.DEMO_STATUS_PATH;
  let tmpDir: string;

  beforeEach(() => {
    spawnMock.mockReset();
    tmpDir = mkdtempSync(join(tmpdir(), 'demo-ops-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (ORIGINAL_STATUS_PATH === undefined) {
      process.env.DEMO_STATUS_PATH = '';
    } else {
      process.env.DEMO_STATUS_PATH = ORIGINAL_STATUS_PATH;
    }
    jest.useRealTimers();
  });

  describe('readStatus', () => {
    it('DEMO_STATUS_PATH 未设 → boot=UNKNOWN（本地验收形态）', () => {
      process.env.DEMO_STATUS_PATH = '';
      const svc = new DemoOpsService();
      expect(svc.readStatus()).toEqual({
        boot: 'UNKNOWN',
        reconBreak: { state: 'idle', tail: [], finishedAt: null },
      });
    });

    it('文件不存在 → boot=UNKNOWN 不抛错', () => {
      process.env.DEMO_STATUS_PATH = join(tmpDir, 'no-such-file');
      const svc = new DemoOpsService();
      expect(svc.readStatus().boot).toBe('UNKNOWN');
    });

    it('文件存在 → 返回去空白后的原文', () => {
      const p = join(tmpDir, 'status');
      writeFileSync(p, 'STARTING:7 demo:all\n');
      process.env.DEMO_STATUS_PATH = p;
      const svc = new DemoOpsService();
      expect(svc.readStatus().boot).toBe('STARTING:7 demo:all');
    });
  });

  describe('requestReset', () => {
    it('先覆写状态文件为 reset-requested，再延时 process.exit(1)', () => {
      jest.useFakeTimers();
      const p = join(tmpDir, 'status');
      writeFileSync(p, 'READY\n');
      process.env.DEMO_STATUS_PATH = p;
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      const svc = new DemoOpsService();
      expect(svc.requestReset()).toEqual({ accepted: true });
      expect(svc.readStatus().boot).toBe('STARTING:reset-requested'); // 消除 READY 窗口期
      expect(exitSpy).not.toHaveBeenCalled(); // 202 响应要先飞出去
      jest.advanceTimersByTime(600);
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('DEMO_STATUS_PATH 未设也不抛错（本地误按场景）', () => {
      jest.useFakeTimers();
      process.env.DEMO_STATUS_PATH = '';
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const svc = new DemoOpsService();
      expect(svc.requestReset()).toEqual({ accepted: true });
      jest.advanceTimersByTime(600);
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  describe('startReconBreak', () => {
    it('spawn npm run recon:demo:break（继承 cwd/env），状态 running → done', () => {
      const child = new FakeChild();
      spawnMock.mockReturnValue(child);
      const svc = new DemoOpsService();

      expect(svc.startReconBreak()).toEqual({ accepted: true });
      expect(spawnMock).toHaveBeenCalledWith('npm', ['run', 'recon:demo:break'], {
        cwd: process.cwd(),
        env: process.env,
      });
      expect(svc.readStatus().reconBreak.state).toBe('running');

      child.stdout.emit('data', Buffer.from('mirror ok\ninjected 18 scenarios\n'));
      child.emit('close', 0);
      const after = svc.readStatus().reconBreak;
      expect(after.state).toBe('done');
      expect(after.tail).toContain('injected 18 scenarios');
      expect(after.finishedAt).not.toBeNull();
    });

    it('退出码非 0 → fail，stderr 进 tail', () => {
      const child = new FakeChild();
      spawnMock.mockReturnValue(child);
      const svc = new DemoOpsService();
      svc.startReconBreak();
      child.stderr.emit('data', Buffer.from('FATAL boom\n'));
      child.emit('close', 1);
      const after = svc.readStatus().reconBreak;
      expect(after.state).toBe('fail');
      expect(after.tail).toContain('FATAL boom');
    });

    it('spawn 自身报错（error 事件）→ fail', () => {
      const child = new FakeChild();
      spawnMock.mockReturnValue(child);
      const svc = new DemoOpsService();
      svc.startReconBreak();
      child.emit('error', new Error('npm not found'));
      expect(svc.readStatus().reconBreak.state).toBe('fail');
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/demo-ops/demo-ops.service.spec.ts`
Expected: FAIL — `Cannot find module './demo-ops.service'`

- [ ] **Step 3: 最小实现**

```ts
// src/modules/demo-ops/demo-ops.service.ts
// 云端演示自助还原（spec 2026-09-13-cloud-demo-ops-buttons-design.md §3）。
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export type ReconBreakState = 'idle' | 'running' | 'done' | 'fail';

const TAIL_LINES = 40;
const EXIT_DELAY_MS = 500; // 让 202 响应先飞出去再退进程

@Injectable()
export class DemoOpsService {
  private readonly logger = new Logger(DemoOpsService.name);

  private reconBreak: { state: ReconBreakState; tail: string[]; finishedAt: string | null } = {
    state: 'idle',
    tail: [],
    finishedAt: null,
  };

  /** 状态双源合并：run/status 文件（云端开机序列写的重铺进度）+ recon-break 子进程内存态。 */
  readStatus() {
    const path = process.env.DEMO_STATUS_PATH;
    let boot = 'UNKNOWN'; // DEMO_STATUS_PATH 未设或文件缺失即此形态（本地验收）
    if (path) {
      try {
        boot = readFileSync(path, 'utf8').trim() || 'UNKNOWN';
      } catch {
        boot = 'UNKNOWN';
      }
    }
    return { boot, reconBreak: this.reconBreak };
  }

  /** 重铺 = 进程自退：demo-run.sh 守护见 API 退出即整服务 exit 1，systemd 重启并从零重铺。 */
  requestReset() {
    const path = process.env.DEMO_STATUS_PATH;
    if (path) {
      try {
        writeFileSync(path, 'STARTING:reset-requested\n'); // 消除「点击后 status 仍是 READY」窗口期
      } catch (e) {
        this.logger.warn(`demo-ops: cannot pre-mark status file: ${String(e)}`);
      }
    }
    this.logger.warn('demo-ops: reset requested — exiting so systemd re-seeds from scratch');
    setTimeout(() => process.exit(1), EXIT_DELAY_MS);
    return { accepted: true as const };
  }

  /** 重摆对账场景：子进程跑 recon:demo:break（脚本自清足迹可重复跑；env/cwd 继承主进程）。 */
  startReconBreak() {
    this.reconBreak = { state: 'running', tail: [], finishedAt: null };
    const child = spawn('npm', ['run', 'recon:demo:break'], { cwd: process.cwd(), env: process.env });
    const push = (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split('\n')
        .filter((l) => l.trim().length > 0);
      this.reconBreak.tail = [...this.reconBreak.tail, ...lines].slice(-TAIL_LINES);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', (err) => {
      this.reconBreak.state = 'fail';
      this.reconBreak.tail = [...this.reconBreak.tail, String(err)].slice(-TAIL_LINES);
      this.reconBreak.finishedAt = new Date().toISOString();
    });
    child.on('close', (code) => {
      this.reconBreak.state = code === 0 ? 'done' : 'fail';
      this.reconBreak.finishedAt = new Date().toISOString();
    });
    return { accepted: true as const };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/demo-ops`
Expected: PASS（8 条用例）

- [ ] **Step 5: 随手闸 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 零错误

```bash
git add src/modules/demo-ops/demo-ops.service.ts src/modules/demo-ops/demo-ops.service.spec.ts
git commit -m "feat(demo-ops): 服务层——状态双源合并/重铺自退/recon-break子进程"
```

---

### Task 2: Controller + Module 门控 + AppModule 挂载 + 云端 env 模板

**Files:**
- Create: `src/modules/demo-ops/demo-ops.controller.ts`
- Create: `src/modules/demo-ops/demo-ops.module.ts`
- Test: `src/modules/demo-ops/demo-ops.module.spec.ts`（门控证据，照 `deposit-demo.module.spec.ts` 模板）
- Test: `src/modules/demo-ops/demo-ops.controller.spec.ts`（守卫元数据 + 委托）
- Modify: `src/app.module.ts`（import 一行 + imports 数组一行，挂在 `DepositDemoModule,` 旁）
- Modify: `deploy/demo.env.template`（追加两行）

**Interfaces:**
- Consumes: Task 1 的 `DemoOpsService.readStatus() / requestReset() / startReconBreak()`
- Produces（Task 3/4 的前端依赖）：
  - `GET /demo-ops/status`（无守卫）→ `{ boot, reconBreak }`
  - `POST /demo-ops/reset`（jwt）→ `{ accepted: true }`（Nest 默认 201）
  - `POST /demo-ops/recon-break`（jwt）→ `{ accepted: true }`
  - 本地未设 `DEMO_OPS` 时三条路由全部 404（前端探测依据）

- [ ] **Step 1: 写失败测试（module 门控 + controller 守卫/委托）**

```ts
// src/modules/demo-ops/demo-ops.module.spec.ts
import { MODULE_METADATA } from '@nestjs/common/constants';

/**
 * 门控证据（照 deposit-demo.module.spec.ts 模板，坑同款）：
 * - @Module() 装饰器在 require 时求值一次，每个 env 值都要 jest.resetModules() 后重新 require；
 * - 同一轮 reset 内 require module + controller 两个文件才能拿到同一批 class 引用；
 * - 用「显式赋空串」模拟未设置，不许 delete（@prisma/client 的 dotenv 会从 .env 悄悄填回，
 *   本地验收时 .env 恰好写着 DEMO_OPS=1，delete 版用例会假失败）。
 */
describe('DemoOpsModule — DEMO_OPS controller gate', () => {
  const ORIGINAL_ENV = process.env.DEMO_OPS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      process.env.DEMO_OPS = '';
    } else {
      process.env.DEMO_OPS = ORIGINAL_ENV;
    }
  });

  function loadModuleParts(): { controllers: unknown[]; DemoOpsController: unknown } {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DemoOpsModule } = require('./demo-ops.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DemoOpsController } = require('./demo-ops.controller');
    const controllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DemoOpsModule) as unknown[]) || [];
    return { controllers, DemoOpsController };
  }

  it('本地（DEMO_OPS 未设）：路由压根不注册', () => {
    process.env.DEMO_OPS = '';
    expect(loadModuleParts().controllers).toEqual([]);
  });

  it('DEMO_OPS=0：路由不注册', () => {
    process.env.DEMO_OPS = '0';
    expect(loadModuleParts().controllers).toEqual([]);
  });

  it('云端（DEMO_OPS=1）：路由注册', () => {
    process.env.DEMO_OPS = '1';
    const { controllers, DemoOpsController } = loadModuleParts();
    expect(controllers).toContain(DemoOpsController);
    expect(controllers.length).toBe(1);
  });
});
```

```ts
// src/modules/demo-ops/demo-ops.controller.spec.ts
import { DemoOpsController } from './demo-ops.controller';

describe('DemoOpsController', () => {
  it('三条路由委托给 service', () => {
    const service = {
      readStatus: jest.fn().mockReturnValue('s'),
      requestReset: jest.fn().mockReturnValue('r'),
      startReconBreak: jest.fn().mockReturnValue('b'),
    };
    const c = new DemoOpsController(service as never);
    expect(c.status()).toBe('s');
    expect(c.reset()).toBe('r');
    expect(c.reconBreak()).toBe('b');
  });

  it('守卫口径：status 免登录，两个 POST 挂 jwt（spec §3 勘误条）', () => {
    const proto = DemoOpsController.prototype as unknown as Record<string, () => unknown>;
    const guardsOf = (method: string) =>
      Reflect.getMetadata('__guards__', proto[method]) as unknown[] | undefined;
    expect(guardsOf('status')).toBeUndefined();
    expect(guardsOf('reset')).toHaveLength(1);
    expect(guardsOf('reconBreak')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/demo-ops/demo-ops.module.spec.ts src/modules/demo-ops/demo-ops.controller.spec.ts`
Expected: FAIL — `Cannot find module './demo-ops.module'` / `'./demo-ops.controller'`

- [ ] **Step 3: 实现 controller + module**

```ts
// src/modules/demo-ops/demo-ops.controller.ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoOpsService } from './demo-ops.service';

/**
 * 云端演示自助还原（spec 2026-09-13-cloud-demo-ops-buttons-design.md）。
 * 门控在模块层：DEMO_OPS=1（仅云端 demo.env 写入）才注册本 controller——
 * 本地路由压根不存在，前端探测 404 即隐藏入口，与 SUMSUB_MOCK_MODE 门同款。
 * 权限口径（spec §3 勘误）：舞台机械不进 RBAC catalog——POST 仅要求登录
 * （同事 Quick Login 任意角色都能按），status 免登录（重铺重建用户表、
 * 旧 token 失效，轮询必须跨越登录态）。
 */
@ApiTags('Demo Ops')
@Controller('demo-ops')
export class DemoOpsController {
  constructor(private readonly demoOps: DemoOpsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Boot/reseed status + recon-break child state (unauthenticated by design)' })
  status() {
    return this.demoOps.readStatus();
  }

  @Post('reset')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Full re-seed: exit the process, systemd restarts and lays fresh demo data' })
  reset() {
    return this.demoOps.requestReset();
  }

  @Post('recon-break')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore the 18 reconciliation break scenarios (recon:demo:break)' })
  reconBreak() {
    return this.demoOps.startReconBreak();
  }
}
```

```ts
// src/modules/demo-ops/demo-ops.module.ts
import { Module } from '@nestjs/common';
import { DemoOpsService } from './demo-ops.service';
import { DemoOpsController } from './demo-ops.controller';

// 与 DepositDemoModule 的 SUMSUB_MOCK_MODE 门同款：DEMO_OPS=1（仅云端 demo.env 写入）
// 才把 controller 放进路由表——本地路由压根不存在，不是靠 guard 拦。
// （main.ts 顶部的 dotenv 前置加载保证装饰器求值时 .env 已生效，同 SUMSUB_MOCK_MODE。）
const DEMO_OPS_ENABLED = process.env.DEMO_OPS === '1';

@Module({
  providers: [DemoOpsService],
  controllers: DEMO_OPS_ENABLED ? [DemoOpsController] : [],
})
export class DemoOpsModule {}
```

- [ ] **Step 4: AppModule 挂载**

`src/app.module.ts` 两处（锚点 grep `DepositDemoModule`）：

```ts
import { DemoOpsModule } from './modules/demo-ops/demo-ops.module';
```

imports 数组里 `DepositDemoModule,` 之后加一行：

```ts
    DemoOpsModule,
```

- [ ] **Step 5: 云端 env 模板追加**

`deploy/demo.env.template` 末尾追加：

```
# 云端演示自助还原按钮（管理台 Simulation → Demo Data；spec 2026-09-13-cloud-demo-ops-buttons-design.md）
DEMO_OPS=1
DEMO_STATUS_PATH=/opt/exchange-demo/run/status
```

- [ ] **Step 6: 跑测试确认通过 + 随手闸**

Run: `npx jest src/modules/demo-ops`
Expected: PASS（3 个 suite 全绿）

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 零错误

- [ ] **Step 7: 提交**

```bash
git add src/modules/demo-ops/ src/app.module.ts deploy/demo.env.template
git commit -m "feat(demo-ops): 三接口+DEMO_OPS门控注册+AppModule挂载+云端env模板"
```

---

### Task 3: 前端 DemoOpsPanel 弹层

**Files:**
- Create: `admin-web/src/components/DemoOpsPanel.tsx`

**Interfaces:**
- Consumes: Task 2 的三条接口；`adminFetch / AdminSessionError / getApiErrorMessage`（`../utils/adminFetch`）；`adminButtonClass`（`./common/adminButtonStyles`）
- Produces（Task 4 依赖）：`default export DemoOpsPanel`，props `{ open: boolean; onClose: () => void }`

前端组件本仓库不可单测（`.spec.tsx` 静默不跑），验证在 Task 5 preview 截图。

- [ ] **Step 1: 实现组件**

```tsx
// admin-web/src/components/DemoOpsPanel.tsx
// 云端演示自助还原面板（spec 2026-09-13-cloud-demo-ops-buttons-design.md §4）。
// status 轮询用裸 fetch（免登录端点）：重铺期间后端整个不在、旧 token 已失效，
// adminFetch 的 401 重定向会把轮询打断。只有两个 POST 走 adminFetch。
import { useEffect, useRef, useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';

interface Props { open: boolean; onClose: () => void }

interface DemoOpsStatus {
  boot: string;
  reconBreak: { state: 'idle' | 'running' | 'done' | 'fail'; tail: string[]; finishedAt: string | null };
}

type ResetPhase = 'idle' | 'confirm' | 'resetting' | 'done';

const POLL_MS = 2000;

const DemoOpsPanel = ({ open, onClose }: Props) => {
  const [status, setStatus] = useState<DemoOpsStatus | null>(null);
  const [resetPhase, setResetPhase] = useState<ResetPhase>('idle');
  const [reconRequested, setReconRequested] = useState(false);
  const [error, setError] = useState('');
  // 重铺完成判定要「先见断线、再见 READY」：点击瞬间文件可能还是 READY。
  const sawDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/demo-ops/status`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const next = (await res.json()) as DemoOpsStatus;
        if (cancelled) return;
        setStatus(next);
        setResetPhase((phase) =>
          phase === 'resetting' && sawDownRef.current && next.boot === 'READY' ? 'done' : phase,
        );
      } catch {
        if (!cancelled) sawDownRef.current = true; // 重铺期间接口不在：预期形态，不当错误展示
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open]);

  if (!open) return null;

  const reconState = status?.reconBreak.state ?? 'idle';
  const busy = resetPhase === 'resetting' || reconState === 'running';

  const requestReset = async () => {
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/demo-ops/reset`, { method: 'POST' });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to start the reset')); return; }
      sawDownRef.current = false;
      setResetPhase('resetting');
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to start the reset');
    }
  };

  const requestReconBreak = async () => {
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/demo-ops/recon-break`, { method: 'POST' });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to start the restore')); return; }
      setReconRequested(true);
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to start the restore');
    }
  };

  const goToSignIn = () => {
    localStorage.removeItem('admin_token');
    window.location.href = '/admin/login';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={resetPhase === 'resetting' ? undefined : onClose}
    >
      <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-adm-t1">Demo Data</h3>
          <span className="font-mono text-[10px] text-adm-t3">{status ? status.boot : '…'}</span>
        </div>
        <p className="mb-4 text-xs text-adm-t3">Self-service restore for the shared demo dataset.</p>

        {resetPhase === 'done' ? (
          <>
            <p className="text-xs text-adm-t2">
              Reset complete — the demo dataset is back to its standard state. Your session has expired;
              please sign in again.
            </p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={goToSignIn} className={adminButtonClass('modalConfirm')}>Go to sign-in</button>
            </div>
          </>
        ) : resetPhase === 'resetting' ? (
          <p className="text-xs text-adm-t2">
            Rebuilding the entire dataset — this takes about a minute and the system is unavailable meanwhile.
            This panel keeps checking and will tell you when it is done.
          </p>
        ) : (
          <>
            {/* ── Full reset ── */}
            <div className="mb-3 rounded border border-adm-border p-3">
              <div className="mb-1 text-xs font-medium text-adm-t1">Full reset</div>
              <p className="mb-2 text-xs text-adm-t3">
                Rebuilds everything from scratch: seeded customers, one full trading day, 18 reconciliation
                scenarios. Takes about a minute; everyone is signed out and manually created data is lost.
              </p>
              {resetPhase === 'confirm' ? (
                <div className="flex items-center justify-end gap-2">
                  <span className="mr-auto text-xs text-adm-red">Wipe all current data and re-seed?</span>
                  <button type="button" onClick={() => setResetPhase('idle')} className={adminButtonClass('modalCancel')}>Cancel</button>
                  <button type="button" disabled={busy} onClick={() => void requestReset()} className={adminButtonClass('modalConfirm')}>Yes, reset everything</button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button type="button" disabled={busy} onClick={() => setResetPhase('confirm')} className={adminButtonClass('modalConfirm')}>Reset all demo data…</button>
                </div>
              )}
            </div>

            {/* ── Recon scenarios ── */}
            <div className="rounded border border-adm-border p-3">
              <div className="mb-1 text-xs font-medium text-adm-t1">Restore reconciliation scenarios</div>
              <p className="mb-2 text-xs text-adm-t3">
                Re-stages only the 18 reconciliation break scenarios (previous runs, cases and dispositions
                are cleared). Customers, transactions and everything else stay untouched. Takes a few seconds.
              </p>
              {reconState === 'running' ? (
                <p className="text-xs text-adm-amber">Restoring… this takes a few seconds.</p>
              ) : reconRequested && reconState === 'done' ? (
                <p className="text-xs text-adm-t2">Done — 18 reconciliation scenarios restored. Open the reconciliation cases page to start over.</p>
              ) : reconRequested && reconState === 'fail' ? (
                <>
                  <p className="mb-1 text-xs text-adm-red">Restore failed — last output:</p>
                  <pre className="max-h-32 overflow-auto rounded bg-adm-hover/40 p-2 font-mono text-[10px] text-adm-t2">{(status?.reconBreak.tail ?? []).slice(-8).join('\n')}</pre>
                </>
              ) : null}
              {reconState !== 'running' && (
                <div className="mt-2 flex justify-end">
                  <button type="button" disabled={busy} onClick={() => void requestReconBreak()} className={adminButtonClass('modalConfirm')}>Restore recon scenarios</button>
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-xs text-adm-red">{error}</p>}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DemoOpsPanel;
```

- [ ] **Step 2: 随手闸**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`
Expected: 零错误（组件尚未被引用，tsc 仍会编译它）

- [ ] **Step 3: 提交**

```bash
git add admin-web/src/components/DemoOpsPanel.tsx
git commit -m "feat(demo-ops): 管理台 Demo Data 面板——重铺轮询断线判定+recon-break状态机"
```

---

### Task 4: DashboardLayout 顶栏入口（探测 + 按钮 + 挂面板）

**Files:**
- Modify: `admin-web/src/components/DashboardLayout.tsx`（Simulation toggle 附近，约 :503；state 区约 :88）

**Interfaces:**
- Consumes: Task 3 的 `DemoOpsPanel`；Task 2 的 `GET /demo-ops/status`（探测）
- Produces: 顶栏「Demo Data」按钮（Simulation 开 + 探测可达才显示）

- [ ] **Step 1: 加 state + 探测 effect**

在 `useSimulationMode()` 解构（约 :88）之后加：

```tsx
  const [demoOpsAvailable, setDemoOpsAvailable] = useState(false);
  const [demoOpsPanelOpen, setDemoOpsPanelOpen] = useState(false);

  // 探测 demo-ops 是否可达（DEMO_OPS=1 才注册路由）：404/网络错误 = 本地，隐藏入口。
  useEffect(() => {
    if (!simulationModeEnabled || demoOpsAvailable) return;
    let cancelled = false;
    void fetch(`${import.meta.env.VITE_API_URL}/demo-ops/status`)
      .then((res) => { if (!cancelled && res.ok) setDemoOpsAvailable(true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [simulationModeEnabled, demoOpsAvailable]);
```

顶部 import 区加：

```tsx
import DemoOpsPanel from './DemoOpsPanel';
```

（`useState` / `useEffect` 已在文件 import 里，若缺则并入现有 react import。）

- [ ] **Step 2: 顶栏按钮 + 挂面板**

Simulation toggle 的 `</label>` 与 `{/* Theme toggle */}` 之间插入：

```tsx
            {/* Demo Data（仅云端：DEMO_OPS 探测可达才显示） */}
            {simulationModeEnabled && demoOpsAvailable && (
              <button
                type="button"
                onClick={() => setDemoOpsPanelOpen(true)}
                className="rounded border border-adm-amber/60 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-amber transition-colors hover:bg-adm-amber/10"
              >
                Demo Data
              </button>
            )}
```

组件 return 的根部（与其它全局弹层同级，`</div>` 收尾前）挂：

```tsx
      <DemoOpsPanel open={demoOpsPanelOpen} onClose={() => setDemoOpsPanelOpen(false)} />
```

- [ ] **Step 3: 随手闸 + 提交**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`
Expected: 零错误

```bash
git add admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(demo-ops): 顶栏 Demo Data 入口——Simulation门控+status探测隐藏本地"
```

---

### Task 5: 本地验证（闸④⑤ + 收尾闸⑥）

**Files:** 无新文件；worktree 本地 `.env` 临时加 `DEMO_OPS=1`（gitignored，验证后删行）

**Interfaces:** 无——本任务产出是证据（jest 全绿 + 截图 + demo:all 全绿）

- [ ] **Step 1: 全量随手闸**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/demo-ops
```

Expected: 全部零错误 / 全绿

- [ ] **Step 2: worktree 起栈 + 铺演示数据（兼收尾闸⑥）**

```bash
bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all
```

Expected: `demo:all DONE ✅ (all asserts pass)`

- [ ] **Step 3: 开门验证 recon-break 全链**

```bash
grep -q '^DEMO_OPS=' .env || echo 'DEMO_OPS=1' >> .env
bash scripts/stack.sh up   # 重启使后端读到新 env
```

preview 打开本 worktree 管理台端口（看 `.stackports`），走查并截图四张：
1. Simulation 关 → 顶栏无 Demo Data 按钮；
2. Simulation 开 → 按钮出现；面板打开，boot 显示 `UNKNOWN`（本地预期形态）；
3. 点 Restore recon scenarios → Restoring… → Done 提示；
4. 对账案件页回到 18 个开放案件的开场态。

**重铺按钮本地不实按**（本地无 systemd 守护，按了 = 后端退出需手动 `stack.sh up`，预期内不可用而非缺陷）。只截确认步文案（Wipe all current data and re-seed?）后点 Cancel。

- [ ] **Step 4: 清理验证残留 + 提交（如有截图入库则随文档任务）**

```bash
sed -i '' '/^DEMO_OPS=1$/d' .env
```

（`.env` 未入库，无需提交；本任务无代码 diff 则不产生 commit。）

---

### Task 6: 文档收口

**Files:**
- Modify: `CLAUDE.md`（§10 云端演示环境段）
- Modify: `deploy/colleague-message.txt`
- Modify: `doc-final/decisions.md`

**Interfaces:** 无

- [ ] **Step 1: CLAUDE.md §10** 云端演示环境列表（`npm run cloud:*` 代码块之后的说明条目区）追加一条：

```
- 同事自助还原：管理台顶栏 Simulation 开关 → Demo Data 面板（重铺数据=整服务自退重启约 1 分钟；重摆对账场景=recon:demo:break 秒级）；`DEMO_OPS=1` 门控，仅云端 demo.env 有，本地无此入口
```

- [ ] **Step 2: colleague-message.txt** 在 `Note:` 行之前插入：

```
Self-service restore (top bar, turn on "Simulation" → "Demo Data"):
  Full reset          — wipes everything, fresh demo data in ~1 minute (sign in again after)
  Restore recon       — re-stages the 18 reconciliation scenarios only, takes seconds
```

- [ ] **Step 3: decisions.md** 追加两条（沿该文件现有条目格式，含日期与一句话理由）：

```
- 2026-09-13 云端演示自助还原：只做云端（DEMO_OPS 门控），重置终态=满数据态；demo:all 不单设按钮——重铺已含，单按只会翻倍+断言假红。已否决：三按钮方案、本地降级形态。
- 2026-09-13 demo-ops 不进 RBAC catalog：POST 仅 AuthGuard(jwt)、status 免登录——同事 Quick Login 任意角色都要能按；舞台机械进权限目录会污染 RBAC 演示。已否决：DEMO_OPS_WRITE 新权限组绑全角色。
```

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md deploy/colleague-message.txt doc-final/decisions.md
git commit -m "docs(demo-ops): CLAUDE.md§10/同事口信/decisions 两定案收口"
```

---

### Task 7: 收尾合并 + 云端实测（主会话执行，不派 subagent）

- [ ] **Step 1**: 对照 `doc-final/rules/delivery-checklist.md` 过一遍触发条件（未动钱/schema/seed → 闸⑦⑧不触发；闸⑥已在 Task 5 Step 2 覆盖）
- [ ] **Step 2**: 用 superpowers:finishing-a-development-branch 合并进 main，清 worktree + 分支；CHANGELOG 一行
- [ ] **Step 3**: 合并后必做——主栈重启后端 + `npm run db:base:sync`
- [ ] **Step 4**: `npm run cloud:deploy`（部署已提交版本，约 74 秒）
- [ ] **Step 5**: 浏览器走查 `https://101.32.141.97`（云端实测，spec §5 ④⑤）并截图：
  1. 登录 → Simulation 开 → Demo Data 按钮出现（本地隐藏、云端出现的对照证据）；
  2. 手动处置 1–2 个对账案件后点 Restore recon scenarios → 18 案件复位、其余数据仍在；
  3. 点 Full reset → 确认 → 面板显示进度 → 约 1 分钟后 Reset complete → 重新登录 → 数据回满数据态（客户 11 人 + 花名册交易 + 18 对账破口）。
- [ ] **Step 6**: Thread 完成行：`Documentation updated: modules§none / demo§none / decisions / CLAUDE.md§10 — 云端自助还原两按钮上线`
