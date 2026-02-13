import { UnauthorizedException } from '@nestjs/common';
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

  it('should reject register request without customerType', async () => {
    await expect(
      controller.register({
        email: 'test@example.com',
        password: '123456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should call register when payload is valid', async () => {
    serviceMock.register.mockResolvedValue({ id: 'c1' });

    await controller.register({
      email: 'test@example.com',
      password: '123456',
      customerType: 'INDIVIDUAL',
    });

    expect(serviceMock.register).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: '123456',
      customerType: 'INDIVIDUAL',
    });
  });

  it('should reject corporate register request without companyName', async () => {
    await expect(
      controller.register({
        email: 'corp@example.com',
        password: '123456',
        customerType: 'CORPORATE',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
