/**
 * 战役丙波一 T3：gateway 复活——JWT 入房 + 信号出口。
 * 铁律②门不可绕：入房必验签。用真实 JwtService + 与生产同源的 secret 签发/验签
 * （非 mock 扫文本），坏 token 用错误 secret 签出，覆盖真实验签失败路径。
 */
import { JwtService } from '@nestjs/jwt';
import { NotificationsGateway } from './notifications.gateway';

const SECRET = process.env.JWT_SECRET || 'secretKey';

function makeClient() {
  return {
    handshake: { auth: {} as Record<string, unknown> },
    join: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({ secret: SECRET });
    gateway = new NotificationsGateway(jwtService);
  });

  describe('handleConnection', () => {
    it('无 token → disconnect，不入房', () => {
      const client = makeClient();

      gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('坏 token（签名对不上生产 secret）→ disconnect，不入房', () => {
      const client = makeClient();
      client.handshake.auth.token = new JwtService({ secret: 'wrong-secret' }).sign({
        sub: 'c1',
        type: 'CUSTOMER',
      });

      gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('type !== "CUSTOMER" 的 token（如 ADMIN）→ disconnect，不入房', () => {
      const client = makeClient();
      client.handshake.auth.token = jwtService.sign({ sub: 'u1', type: 'ADMIN' });

      gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('好 token（CUSTOMER）→ join customer_<userId>，不 disconnect', () => {
      const client = makeClient();
      client.handshake.auth.token = jwtService.sign({ sub: 'c1', type: 'CUSTOMER' });

      gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('customer_c1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('emitCustomerUpdated', () => {
    it("server.to('customer_<id>').emit('customer.updated', {})", () => {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as any;

      gateway.emitCustomerUpdated('c1');

      expect(to).toHaveBeenCalledWith('customer_c1');
      expect(emit).toHaveBeenCalledWith('customer.updated', {});
    });
  });
});
