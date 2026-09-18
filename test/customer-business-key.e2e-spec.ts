import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';

/**
 * 铁律⑥ 对外用业务键：客户域详情端点 2026-09-03 从 :id（UUID + ParseUUIDPipe）
 * 换装 :customerNo（customers.controller.ts resolveCustomerId）。两条断言钉住
 * 换装后的路由语义：业务号可达（200），旧内部 UUID 不再是对外键（404）。
 */
describe('客户域业务键路由（铁律⑥ 对外用业务键）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let fixture: { id: string; customerNo: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 见 approval-expiry.e2e-spec.ts 同款注释：AppModule 挂了大量共享事件名的
    // @OnEvent handler，app.init() 之前把 EventEmitter2 上限提高。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);

    const suffix = Date.now();
    fixture = await prisma.customerMain.create({
      data: {
        email: `cus-bizkey-${suffix}@example.com`,
        customerNo: `CUS-BIZKEY-${suffix}`,
        phone: `+1${suffix}`,
        firstName: 'Biz',
        lastName: 'Key',
        customerType: 'INDIVIDUAL',
        lifecycle: 'ACTIVE',
      },
      select: { id: true, customerNo: true },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@fiatx.com', password: '123456' });
    expect(loginRes.status).toBe(200);
    token = loginRes.body?.access_token;
    expect(typeof token).toBe('string');
  });

  afterAll(async () => {
    await prisma.customerMain.delete({ where: { id: fixture.id } });
    await app.close();
  });

  it('GET /customers/:customerNo —— 业务号可达，响应主体就是该客户', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${fixture.customerNo}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body?.customerNo).toBe(fixture.customerNo);
  });

  it('GET /customers/<内部 UUID> —— 旧键退役，UUID 当业务号查不到即 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customers/${fixture.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
