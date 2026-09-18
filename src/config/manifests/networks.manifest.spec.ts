import { NETWORKS, NETWORK_CODES, assertNetwork, validateAddressForNetwork } from './networks.manifest';
import { VAULTS, platformWalletSlots } from './vaults.manifest';
import { DEFAULT_ASSETS } from './assets.manifest';

describe('网络注册表（spec §2）', () => {
  it('只有 TRON 与 AED_ZAND 两个网络码', () => {
    expect(NETWORK_CODES.sort()).toEqual(['AED_ZAND', 'TRON']);
    expect(NETWORKS.TRON.kind).toBe('CHAIN');
    expect(NETWORKS.AED_ZAND.kind).toBe('BANK_RAIL');
  });
  it('assertNetwork 拒绝未注册的码（旧的 FIAT / 空串都不再合法）', () => {
    expect(() => assertNetwork('FIAT')).toThrow(/Unknown network/);
    expect(() => assertNetwork('')).toThrow(/Unknown network/);
    expect(assertNetwork('TRON').custodian).toBe('HEXTRUST');
  });
  it('TRON 地址按 Base58 形态校验；0x 地址被拒', () => {
    expect(validateAddressForNetwork('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').valid).toBe(true);
    expect(validateAddressForNetwork('TRON', '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18').valid).toBe(false);
  });
  it('AED_ZAND 的地址形态是 AE + 21 位数字', () => {
    expect(validateAddressForNetwork('AED_ZAND', 'AE070860000000000000001').valid).toBe(true);
    expect(validateAddressForNetwork('AED_ZAND', 'GB29NWBK60161331926819').valid).toBe(false);
  });
});

describe('vault 注册表（spec §4）', () => {
  it('五个 vault；F_SET 只在法币通道', () => {
    expect(Object.keys(VAULTS).sort()).toEqual(['CLIENT_DEPOSIT', 'F_FEE', 'F_LIQ', 'F_OPS', 'F_SET']);
    expect(VAULTS.F_SET.networks).toEqual(['AED_ZAND']);
  });
  it('平台地址行恒 7 个槽位（4 vault × 2 网络 − F_SET 的 TRON）', () => {
    const slots = platformWalletSlots();
    expect(slots).toHaveLength(7);
    expect(slots).not.toContainEqual({ vaultCode: 'F_SET', network: 'TRON' });
  });
});

describe('资产清单（spec §3）', () => {
  it('两条资产，网络码都在注册表里，USDT-TRON 带 TRC-20 合约', () => {
    expect(DEFAULT_ASSETS).toHaveLength(2);
    for (const a of DEFAULT_ASSETS) expect(NETWORK_CODES).toContain(a.network);
    const usdt = DEFAULT_ASSETS.find((a) => a.code === 'USDT-TRON')!;
    expect(usdt.contractAddress).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(usdt.standard).toBe('TRC-20');
    expect(usdt.isNative).toBe(false);
    const aed = DEFAULT_ASSETS.find((a) => a.code === 'AED')!;
    expect(aed.network).toBe('AED_ZAND');
    expect(aed.contractAddress).toBeNull();
  });
});
