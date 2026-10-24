/** LP 两步准入 Task 6 · ⚡到货缺省来源（干净占位）：⚡不带来源坐标时用它——腿 2 的 from 与单据快照都落它，筛查必 GREEN。
 *  形状像真坐标（TRON：T 开头 34 位；法币：AE + 21 位数字的阿联酋 IBAN），内容肉眼可见是占位（Placeholder / 全零），
 *  尾号 0000 与 mock 约定的 VASP(1111) / 黄(2222) / 红(3333) / 灰港(4444) 都不撞。导出给 demo/data.md 抄写、种子与测试断言用。
 *  终审 M2：原住 lp-exchange-workflow.service.ts，种子为取一个常量而 import 整个工作流服务——挪到常量目录，种子不再依赖服务文件。 */
export const DEFAULT_DELIVERY_SOURCE = {
  CRYPTO: 'TDeliverySourcePlaceholder00000000',
  FIAT: 'AE000000000000000000000',
} as const;
