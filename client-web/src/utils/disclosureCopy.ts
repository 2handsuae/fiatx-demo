// client-web/src/utils/disclosureCopy.ts
//
// 披露文案登记处（与 swapStatusView.ts 同族：写死代码集中登记）。
// 文案是红线物（业主已批）：页面只许从这里引用，禁止在 JSX 里写死英文句子。

export const DISCLOSURE_COPY = {
  principal: 'FIATX acts as principal — you are trading directly with FIATX, not with another client.',
  rateTemplate: 'Your rate is the market reference rate ({source}, {time}) adjusted by our {spread}% spread.',
  conflict: 'FIATX earns the spread and fee on this trade, so our interests may differ from yours.',
  retainedLabel: 'Retained by FIATX',
  principalPast: 'FIATX acted as principal in this trade.',
  figuresFixed: 'Figures were fixed when you confirmed and will not change.',
  riskChain: 'Blockchain transfers are irreversible — funds sent to a wrong address or network cannot be recovered.',
  riskFiat: 'Bank transfers cannot be recalled once sent.',
  riskDeposit: 'Virtual assets are volatile and can lose part or all of their value.',
} as const;

export const fillRateDisclosure = (source: string, fetchedAt: string, spread: number): string =>
  DISCLOSURE_COPY.rateTemplate.replace('{source}', source)
    .replace('{time}', new Date(fetchedAt).toLocaleTimeString()).replace('{spread}', String(spread));
