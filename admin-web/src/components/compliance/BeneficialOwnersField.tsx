// admin-web/src/components/compliance/BeneficialOwnersField.tsx
// 甲波六 T8：LP 申请页与服务商申请页共用的「实际控制人（UBO）」行——序号规则（R4）只留这一份。
// 序号 seq 的规矩：后端按 seq + 姓名认「这位实控人已筛过」，所以
//   · 新申请：还没有任何筛查记录指向序号，增删后顺排即可；
//   · 重提：已有的人保留原 seq、绝不重排，新增的人取「历史最大 seq + 1」，计数器只增不减、被删掉的序号不复用。
import { useCallback, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';

export interface OwnerRow {
  seq: number;
  name: string;
  nationality: string;
}

/** 提交体里的 beneficialOwners：只带填了名字的行；国籍可选。 */
export const ownersPayload = (owners: OwnerRow[]) =>
  owners
    .filter((o) => o.name.trim())
    .map((o) => ({ seq: o.seq, name: o.name.trim(), ...(o.nationality.trim() ? { nationality: o.nationality.trim() } : {}) }));

/** 有国籍没名字的行——申请表的唯一一条实控人必填规则。 */
export const hasNamelessOwner = (owners: OwnerRow[]): boolean => owners.some((o) => !o.name.trim() && o.nationality.trim());

export const useBeneficialOwners = (isResubmit: boolean) => {
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  /** 重提模式下的下一个 seq：只增不减。 */
  const nextSeq = useRef(1);

  /** 重提预填：载入已有名单，并把计数器推到历史最大 seq + 1。 */
  const load = useCallback((existing: { seq: number; name: string; nationality?: string }[]) => {
    setOwners(existing.map((o) => ({ seq: o.seq, name: o.name, nationality: o.nationality ?? '' })));
    nextSeq.current = existing.reduce((m, o) => Math.max(m, o.seq), 0) + 1;
  }, []);

  const addOwner = () => {
    const seq = isResubmit ? nextSeq.current++ : owners.length + 1;
    setOwners((cur) => [...cur, { seq, name: '', nationality: '' }]);
  };
  const removeOwner = (seq: number) =>
    setOwners((cur) => {
      const rest = cur.filter((o) => o.seq !== seq);
      // 新申请还没有任何筛查记录指向序号，删完顺排即可；重提时序号已被筛查记录引用，不得重排。
      return isResubmit ? rest : rest.map((o, i) => ({ ...o, seq: i + 1 }));
    });
  const patchOwner = (seq: number, patch: Partial<OwnerRow>) =>
    setOwners((cur) => cur.map((o) => (o.seq === seq ? { ...o, ...patch } : o)));

  return { owners, load, addOwner, removeOwner, patchOwner };
};

export const BeneficialOwnersField = ({
  owners,
  hint,
  onAdd,
  onRemove,
  onPatch,
}: {
  owners: OwnerRow[];
  /** 标题后的灰色小字（LP 与服务商各有各的措辞）。 */
  hint: string;
  onAdd: () => void;
  onRemove: (seq: number) => void;
  onPatch: (seq: number, patch: Partial<OwnerRow>) => void;
}) => (
  <div className="md:col-span-2">
    <div className="flex items-center justify-between">
      <p className="text-xs">Beneficial owners <span className="text-adm-t3">({hint})</span></p>
      <button type="button" onClick={onAdd} className={adminButtonClass('detailUtility')}>
        <Plus size={13} /> Add beneficial owner
      </button>
    </div>
    {owners.length === 0 ? (
      <p className="mt-2 font-mono text-[11px] text-adm-t3">None listed</p>
    ) : (
      <div className="mt-2 space-y-2">
        {owners.map((o) => (
          <div key={o.seq} className="flex items-center gap-2">
            <span className="w-8 shrink-0 font-mono text-[11px] text-adm-t3">#{o.seq}</span>
            <input
              value={o.name}
              onChange={(e) => onPatch(o.seq, { name: e.target.value })}
              className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
              placeholder="Full name"
              aria-label={`Beneficial owner #${o.seq} name`}
            />
            <input
              value={o.nationality}
              onChange={(e) => onPatch(o.seq, { nationality: e.target.value })}
              className="w-40 shrink-0 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
              placeholder="Nationality (optional)"
              aria-label={`Beneficial owner #${o.seq} nationality`}
            />
            <button
              type="button"
              onClick={() => onRemove(o.seq)}
              className="shrink-0 rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-red"
              title="Remove this beneficial owner"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);
