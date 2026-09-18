export enum OwnerType {
  PLATFORM = 'PLATFORM',
  CUSTOMER = 'CUSTOMER',
  LIQUIDITY_PROVIDER = 'LIQUIDITY_PROVIDER',
}

/** 平台侧角色 = vault 码本身；客户侧按网络种类：链上 C_DEP / 法币通道 C_VIBAN。
 *  C_MAIN / C_OUT / C_CMA 已随 V7 池子退役，波一把枚举一起拔掉。 */
export enum WalletRole {
  C_DEP = 'C_DEP',
  C_VIBAN = 'C_VIBAN',
  F_LIQ = 'F_LIQ',
  F_OPS = 'F_OPS',
  F_SET = 'F_SET',
  F_FEE = 'F_FEE',
}

/** 只有开地址那一小段生命周期；ACTIVE / FAILED 都是终态（迁移表见 wallets.service.ts） */
export enum WalletStatus {
  CREATING = 'CREATING',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
}
