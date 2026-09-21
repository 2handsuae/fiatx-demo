import { ReconciliationSweepService } from './reconciliation-sweep.service';
import { toBusinessDate, endOfBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

describe('ReconciliationSweepService.cutoffForYesterday（波五终审第10位点）', () => {
  it('走 toBusinessDate/endOfBusinessDate 迪拜口径，不手拼 setUTCHours', () => {
    const svc = new ReconciliationSweepService({} as any);
    const now = new Date('2026-09-22T10:00:00.000Z');
    const cutoff = svc.cutoffForYesterday(now);
    const expected = endOfBusinessDate(toBusinessDate(new Date(now.getTime() - 86_400_000)));
    expect(cutoff).toEqual(expected);
    expect(cutoff.toISOString()).toBe('2026-09-21T19:59:59.999Z');
  });
});
