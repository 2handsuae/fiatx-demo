// LP 两步准入 Task 2 · 实体背调 mock（站在 Sumsub 一侧的能力；mock 触点册登记随文档同步任务落）。
// 公司名筛查与地址筛查语义不同，故不扩共享 TRAVEL_RULE_ADAPTER（会牵连 deposit / withdraw /
// withdrawal-addresses 三个 provide 模块陪跑），放 lp-desk 本地纯函数；只借 ScreeningAnswer 类型。
// 约定（与地址尾号约定同精神——演示者输入已知名称得到已知结局，大小写不敏感）：
//   名称含 sanction → RED（建档当场拒）｜ 含 offshore → YELLOW（放行留痕）｜ 其余 GREEN。
// 两词并存时 RED 压过 YELLOW。
import type { ScreeningAnswer } from '../../sumsub-shared/travel-rule/travel-rule-adapter.interface';

export function screenLpEntityName(name: string): ScreeningAnswer {
  if (/sanction/i.test(name)) return 'RED';
  if (/offshore/i.test(name)) return 'YELLOW';
  return 'GREEN';
}
