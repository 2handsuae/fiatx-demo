import { ConflictException, NotFoundException } from '@nestjs/common';
import { InterimDispositionIncidentLink } from './incidents.module';

function makeLink(disposition: any = null) {
  const prisma: any = {
    reconciliationDisposition: {
      findUnique: jest.fn(async () => disposition),
      update: jest.fn(async ({ data }: any) => ({ ...disposition, ...data })),
    },
  };
  const link = new InterimDispositionIncidentLink(prisma);
  return { link, prisma };
}

describe('InterimDispositionIncidentLink（Task 9 落地前的占位适配器，Task 5 评审补测）', () => {
  it('定性行不存在 → 404，未调用 update', async () => {
    const { link, prisma } = makeLink(null);
    await expect(link.attachIncident('RCD1', 'INC1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(link.attachIncident('RCD1', 'INC1')).rejects.toThrow(/定性行不存在：RCD1/);
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });

  it('定性行已挂事故 → 409，未调用 update', async () => {
    const { link, prisma } = makeLink({ dispositionNo: 'RCD1', incidentNo: 'INC0' });
    await expect(link.attachIncident('RCD1', 'INC1')).rejects.toBeInstanceOf(ConflictException);
    await expect(link.attachIncident('RCD1', 'INC1')).rejects.toThrow(/定性行 RCD1 已挂事故 INC0，不能再挂/);
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });

  it('正路径：update 只写 incidentNo 一列', async () => {
    const { link, prisma } = makeLink({ dispositionNo: 'RCD1', incidentNo: null });
    await link.attachIncident('RCD1', 'INC1');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD1' },
      data: { incidentNo: 'INC1' },
    });
  });
});
