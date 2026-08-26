import { execSync } from 'child_process';

/**
 * 第一批 · 打点位置守则
 *
 * 与计划初稿的两处差异（均有实证依据，见 .superpowers/sdd/progress.md）：
 *
 * 1. 判定改为「真实调用」而非 `grep -rl` 的原始文本命中。
 *    初稿写法把注释里提到的 recordByActor 也算违规——
 *    audit-evidence-package.controller.ts:74 的注释正是这样被误报的，
 *    而它的真实调用早已上收到 workflowService.downloadEvidencePackage()。
 *
 * 2. 领域服务断言范围收敛到 V1 治理域（IAM / CONFIG / AUDIT / APPROVAL）。
 *    业主 2026-08-25 裁定：「你只要保证 V1 的内容，所有审计是对的，其他的不用管。」
 *    交易/客户/登记/钱包域的 20 个领域服务写的 55 个动作码经交叉比对 V1 命中为 0，
 *    且这些域不存在可搬入的编排层（identity 的 10 个 workflow 全属 users/+access-control/），
 *    上收它们等同于给这些域新建编排层 —— 独立工程，留各域自己的审计任务。
 *    BACKLOG 已登记。
 */
describe('第一批 · 打点位置守则', () => {
  /** 真实调用点：排除注释行，覆盖 `await this.x.record*(` 与换行链式 `.record*(` 两种写法。 */
  function filesWithRealAuditCall(pathFilter: string): string[] {
    const out = execSync(
      `grep -rln "recordByActor\\|recordSystem" src --include="*.ts" | grep -v "\\.spec\\." ${pathFilter} || true`,
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);

    return out.filter((f) => {
      const src = require('fs').readFileSync(f, 'utf8') as string;
      return src
        .split('\n')
        .some((line) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
          return /(^|[.\s(])(recordByActor|recordSystem)\s*\(/.test(t);
        });
    });
  }

  it('V1 治理域的领域服务零审计调用（只有编排层写审计）', () => {
    const v1Modules = '| grep -E "src/modules/identity/(users|access-control)/|src/modules/governance/approvals/"';
    const allowed =
      /(workflow\.service\.ts|approvals\.service\.ts|audit-logs\.service\.ts|sla\.service\.ts|\.handler\.ts|audit-actions\.constant\.ts)$/;

    const violators = filesWithRealAuditCall(v1Modules).filter((f) => !allowed.test(f));
    expect(violators).toEqual([]);
  });

  it('controller 零审计调用（AUDIT_LOG_QUERIED 是唯一例外）', () => {
    const violators = filesWithRealAuditCall('| grep "\\.controller\\.ts"');
    expect(violators).toEqual(['src/modules/audit-logging/audit-logs.controller.ts']);
  });
});
