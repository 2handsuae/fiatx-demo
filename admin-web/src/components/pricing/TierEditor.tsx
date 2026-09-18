import { useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';

/* ── Types ─────────────────────────────────────────────────── */

export interface FeeItemState {
  id: string;
  itemCode: string;
  calcType: string;
  value: string;
  min: string;
  max: string;
  roundingMode: string;
}

export interface TierState {
  id: string;
  name: string;
  enabled: boolean;
  amountMin: string;
  amountMax: string;
  rateMarkupBps?: string;
  feeItems: FeeItemState[];
}

/* ── Defaults ──────────────────────────────────────────────── */

const WITHDRAWAL_ITEM_CODES = ['WITHDRAW_SERVICE_FEE', 'NETWORK_FEE_EST'] as const;
const SWAP_ITEM_CODES = ['SWAP_SERVICE_FEE', 'COMPLIANCE_FEE'] as const;
const CALC_TYPES = ['FLAT', 'PERCENT'] as const;
const ROUNDING_MODES = ['ROUND', 'CEIL', 'FLOOR'] as const;

const newFeeItem = (tierId: string, index: number): FeeItemState => ({
  id: `${tierId}-FEE-${index + 1}`,
  itemCode: WITHDRAWAL_ITEM_CODES[0],
  calcType: 'FLAT',
  value: '0',
  min: '',
  max: '',
  roundingMode: 'ROUND',
});

export const newTier = (index: number): TierState => {
  const tierId = `TIER-${index + 1}`;
  return {
    id: tierId,
    name: index === 0 ? 'Default Tier' : `Tier ${index + 1}`,
    enabled: true,
    amountMin: '0',
    amountMax: '',
    feeItems: [newFeeItem(tierId, 0)],
  };
};

/* ── Serialization ─────────────────────────────────────────── */
// currency + decimals (DP) are derived from the asset by the pricing engine,
// so they are not part of the editable config. roundingMode stays configurable.

export function serializeTiers(tiers: TierState[]): string {
  return JSON.stringify({
    tiers: tiers.map((t, ti) => ({
      id: t.id || `TIER-${ti + 1}`,
      name: t.name,
      enabled: t.enabled,
      ...(t.rateMarkupBps != null && t.rateMarkupBps !== '' ? { rateMarkupBps: Number(t.rateMarkupBps) } : {}),
      conditions: {
        amountMin: t.amountMin ? Number(t.amountMin) : 0,
        amountMax: t.amountMax ? Number(t.amountMax) : null,
      },
      feeItems: t.feeItems.map((f, fi) => ({
        id: f.id || `TIER-${ti + 1}-FEE-${fi + 1}`,
        itemCode: f.itemCode,
        calcType: f.calcType,
        value: String(f.value),
        min: f.min ? String(f.min) : null,
        max: f.max ? String(f.max) : null,
        roundingMode: f.roundingMode,
      })),
    })),
  });
}

export function parseTiersJson(json: string): TierState[] {
  try {
    const parsed = JSON.parse(json) as { tiers: any[] };
    return parsed.tiers.map((t: any) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      amountMin: String(t.conditions.amountMin ?? 0),
      amountMax: t.conditions.amountMax != null ? String(t.conditions.amountMax) : '',
      rateMarkupBps: t.rateMarkupBps != null ? String(t.rateMarkupBps) : '',
      feeItems: t.feeItems.map((f: any) => ({
        id: f.id,
        itemCode: f.itemCode,
        calcType: f.calcType,
        value: String(f.value),
        min: f.min ? String(f.min) : '',
        // tolerate legacy `cap` when loading older configs
        max: f.max ?? f.cap ? String(f.max ?? f.cap) : '',
        roundingMode: f.roundingMode ?? 'ROUND',
      })),
    }));
  } catch {
    return [newTier(0)];
  }
}

/* ── Input style ───────────────────────────────────────────── */

const fi =
  'h-[28px] rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

/* ── Component ─────────────────────────────────────────────── */

interface TierEditorProps {
  tiers: TierState[];
  onChange: (tiers: TierState[]) => void;
  /** 'withdrawal' (default) or 'swap' — controls item codes dropdown and rateMarkupBps input */
  mode?: 'withdrawal' | 'swap';
}

export default function TierEditor({ tiers, onChange, mode = 'withdrawal' }: TierEditorProps) {
  const ITEM_CODES = mode === 'swap' ? SWAP_ITEM_CODES : WITHDRAWAL_ITEM_CODES;

  // Normalize any fee-item code that isn't valid for the current mode (e.g. a
  // withdrawal default code carried into a swap tier) to the first valid code.
  useEffect(() => {
    const valid = new Set<string>(ITEM_CODES as readonly string[]);
    let changed = false;
    const next = tiers.map((t) => ({
      ...t,
      feeItems: t.feeItems.map((f) => {
        if (!valid.has(f.itemCode)) {
          changed = true;
          return { ...f, itemCode: ITEM_CODES[0] };
        }
        return f;
      }),
    }));
    if (changed) onChange(next);
  }, [mode, tiers, ITEM_CODES, onChange]);

  const updateTier = (idx: number, patch: Partial<TierState>) => {
    const next = tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onChange(next);
  };

  const updateFeeItem = (tierIdx: number, feeIdx: number, patch: Partial<FeeItemState>) => {
    const next = tiers.map((t, ti) =>
      ti === tierIdx
        ? {
            ...t,
            feeItems: t.feeItems.map((f, fi) =>
              fi === feeIdx ? { ...f, ...patch } : f,
            ),
          }
        : t,
    );
    onChange(next);
  };

  const addFeeItem = (tierIdx: number) => {
    const tier = tiers[tierIdx];
    const item = newFeeItem(tier.id, tier.feeItems.length);
    item.itemCode = ITEM_CODES[0];
    updateTier(tierIdx, { feeItems: [...tier.feeItems, item] });
  };

  const removeFeeItem = (tierIdx: number, feeIdx: number) => {
    const tier = tiers[tierIdx];
    if (mode !== 'swap' && tier.feeItems.length <= 1) return;
    updateTier(tierIdx, {
      feeItems: tier.feeItems.filter((_, i) => i !== feeIdx),
    });
  };

  const addTier = () => {
    onChange([...tiers, newTier(tiers.length)]);
  };

  const removeTier = (idx: number) => {
    if (tiers.length <= 1) return;
    onChange(tiers.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {tiers.map((tier, tierIdx) => (
        <div key={tier.id} className="rounded border border-adm-border bg-adm-bg p-3">
          {/* Tier header */}
          <div className="mb-2 flex items-center gap-2">
            <input
              className={`${fi} flex-1`}
              value={tier.name}
              onChange={(e) => updateTier(tierIdx, { name: e.target.value })}
              placeholder="Tier name"
            />
            <label className="flex items-center gap-1 font-mono text-[10px] text-adm-t3">
              <input
                type="checkbox"
                checked={tier.enabled}
                onChange={(e) => updateTier(tierIdx, { enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          {/* Rate markup (swap mode only) */}
          {mode === 'swap' && (
            <div className="mb-2 flex items-center gap-2">
              <label className="font-mono text-[10px] text-adm-t3">Rate Markup (bps):</label>
              <input
                type="number"
                className={`${fi} w-[80px]`}
                value={tier.rateMarkupBps ?? ''}
                onChange={(e) => updateTier(tierIdx, { rateMarkupBps: e.target.value })}
                placeholder="0"
              />
              {tier.rateMarkupBps && Number(tier.rateMarkupBps) > 0 && (
                <span className="font-mono text-[10px] text-adm-amber">
                  ({(Number(tier.rateMarkupBps) / 100).toFixed(2)}%)
                </span>
              )}
            </div>
          )}

          {/* Amount range */}
          <div className="mb-2 flex items-center gap-2">
            <label className="font-mono text-[10px] text-adm-t3">Range:</label>
            <input
              type="number"
              className={`${fi} w-[80px]`}
              value={tier.amountMin}
              onChange={(e) => updateTier(tierIdx, { amountMin: e.target.value })}
              placeholder="0"
            />
            <span className="text-adm-t3">—</span>
            <input
              type="number"
              className={`${fi} w-[80px]`}
              value={tier.amountMax}
              onChange={(e) => updateTier(tierIdx, { amountMax: e.target.value })}
              placeholder="No limit"
            />
          </div>

          {/* Fee items table */}
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-adm-panel font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                <th className="px-1.5 py-1 text-left">Item Code</th>
                <th className="px-1.5 py-1 text-left">Calc Type</th>
                <th className="px-1.5 py-1 text-left">Value</th>
                <th className="px-1.5 py-1 text-left">Min</th>
                <th className="px-1.5 py-1 text-left">Max</th>
                <th className="px-1.5 py-1 text-left">Round</th>
                <th className="px-1.5 py-1 w-[28px]" />
              </tr>
            </thead>
            <tbody>
              {tier.feeItems.map((fee, feeIdx) => (
                <tr key={fee.id} className="border-t border-adm-border">
                  <td className="px-1 py-1">
                    <select
                      className={`${fi} w-full min-w-[140px]`}
                      value={fee.itemCode}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { itemCode: e.target.value })}
                    >
                      {ITEM_CODES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={`${fi} w-full min-w-[80px]`}
                      value={fee.calcType}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { calcType: e.target.value })}
                    >
                      {CALC_TYPES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="any"
                      className={`${fi} w-[70px]`}
                      value={fee.value}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { value: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="any"
                      className={`${fi} w-[60px]`}
                      value={fee.min}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { min: e.target.value })}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="any"
                      className={`${fi} w-[60px]`}
                      value={fee.max}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { max: e.target.value })}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={`${fi} w-[65px]`}
                      value={fee.roundingMode}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { roundingMode: e.target.value })}
                    >
                      {ROUNDING_MODES.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    {(tier.feeItems.length > 1 || mode === 'swap') && (
                      <button
                        type="button"
                        onClick={() => removeFeeItem(tierIdx, feeIdx)}
                        className="rounded p-0.5 text-adm-t3 hover:text-adm-danger"
                        title="Remove fee item"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Tier actions */}
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => addFeeItem(tierIdx)}
              className="flex items-center gap-1 font-mono text-[10px] text-adm-amber hover:underline"
            >
              <Plus size={10} /> Add Fee Item
            </button>
            {tiers.length > 1 && (
              <button
                type="button"
                onClick={() => removeTier(tierIdx)}
                className="flex items-center gap-1 font-mono text-[10px] text-adm-danger hover:underline"
              >
                <Trash2 size={10} /> Remove Tier
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addTier}
        className={adminButtonClass('listSecondary')}
      >
        <Plus size={12} /> Add Tier
      </button>
    </div>
  );
}
