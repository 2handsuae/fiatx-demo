import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';

describe('CustomerAuthController', () => {
  let controller: CustomerAuthController;
  const serviceMock = {
    register: jest.fn(),
    login: jest.fn(),
    validateCustomer: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerAuthController],
      providers: [
        {
          provide: CustomerAuthService,
          useValue: serviceMock,
        },
      ],
    }).compile();

    controller = module.get<CustomerAuthController>(CustomerAuthController);
  });

  const mockReq = { id: 'req-1', headers: {}, ip: '127.0.0.1' } as any;

  it('should default customerType to INDIVIDUAL when omitted', async () => {
    serviceMock.register.mockResolvedValue({ id: 'c1' });

    await controller.register(mockReq, {
      email: 'test@example.com',
      password: '123456',
    });

    expect(serviceMock.register).toHaveBeenCalledWith(
      {
        email: 'test@example.com',
        password: '123456',
        customerType: 'INDIVIDUAL',
      },
      expect.objectContaining({ sourcePlatform: 'CUSTOMER_AUTH_API' }),
    );
  });

  it('should call register when payload is valid', async () => {
    serviceMock.register.mockResolvedValue({ id: 'c1' });

    await controller.register(mockReq, {
      email: 'test@example.com',
      password: '123456',
      customerType: 'INDIVIDUAL',
    });

    expect(serviceMock.register).toHaveBeenCalledWith(
      {
        email: 'test@example.com',
        password: '123456',
        customerType: 'INDIVIDUAL',
      },
      expect.objectContaining({ sourcePlatform: 'CUSTOMER_AUTH_API' }),
    );
  });

  it('should reject corporate register request without companyName', async () => {
    await expect(
      controller.register(mockReq, {
        email: 'corp@example.com',
        password: '123456',
        customerType: 'CORPORATE',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject login when customer account is frozen', async () => {
    serviceMock.validateCustomer.mockRejectedValue(
      new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_FROZEN',
        message: '账号已冻结，禁止登录。请联系 WhatsApp 客服处理。',
      }),
    );

    await expect(
      controller.login(
        { id: 'req-1', headers: {}, ip: '127.0.0.1' } as any,
        {
          email: 'test@example.com',
          password: '123456',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
