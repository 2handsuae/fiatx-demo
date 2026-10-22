/**
 * 提现地址的客户面投影——tipping-off 遮蔽由后端执行，前端不渲染不算数。
 *
 * 白名单、默认拒绝：库里以后新增的列不会自动漏给客户。
 * 客户看不到的（不在白名单里）：
 *   - 筛查结论与时间（screeningAnswer / screenedAt）、托管红旗（hostingMismatch）——合规内部判断，
 *     客户只看得到「等待中 / 已拒绝」这类状态，看不到为什么；
 *   - 停用理由与操作人（suspendReason / suspendedBy）——存量连带：原先 client 接口整行直出，一并收口；
 *   - 其余内部键（id / customerId / customerNo / traceId 等）：对外只认业务键 addressNo。
 * 客户要靠 ownershipProofType + ownershipVerifiedAt + status 画「待签名」按钮，这三项必须留。
 *
 * 只给 client 控制器用；admin 控制器照旧返回全量。
 */
const CUSTOMER_VISIBLE_FIELDS = [
  'addressNo',
  'status',
  'network',
  'address',
  'addressType',
  'iban',
  'swiftBic',
  'bankName',
  'label',
  'memo',
  'ownerType',
  'beneficiaryName',
  'beneficiaryRelationship',
  'declaredHosting',
  'counterpartyVaspName',
  'ownershipProofType',
  'ownershipDeclaredAt',
  'ownershipVerifiedAt',
  'activatesAt',
  'activatedAt',
  'suspendedAt',
  'cancelledAt',
  'deactivatedAt',
  'createdAt',
] as const;

export function toCustomerView(row: Record<string, any>): Record<string, any> {
  const view: Record<string, any> = {};
  for (const key of CUSTOMER_VISIBLE_FIELDS) {
    if (key in row) view[key] = row[key];
  }
  return view;
}

export function toCustomerListView(page: { items: Record<string, any>[]; total: number }) {
  return { items: page.items.map(toCustomerView), total: page.total };
}
