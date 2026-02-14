"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const customer_auth_controller_1 = require("./customer-auth.controller");
const customer_auth_service_1 = require("./customer-auth.service");
describe('CustomerAuthController', () => {
    let controller;
    const serviceMock = {
        register: jest.fn(),
        login: jest.fn(),
        validateCustomer: jest.fn(),
    };
    beforeEach(async () => {
        jest.clearAllMocks();
        const module = await testing_1.Test.createTestingModule({
            controllers: [customer_auth_controller_1.CustomerAuthController],
            providers: [
                {
                    provide: customer_auth_service_1.CustomerAuthService,
                    useValue: serviceMock,
                },
            ],
        }).compile();
        controller = module.get(customer_auth_controller_1.CustomerAuthController);
    });
    it('should reject register request without customerType', async () => {
        await expect(controller.register({
            email: 'test@example.com',
            password: '123456',
        })).rejects.toBeInstanceOf(common_1.UnauthorizedException);
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
        await expect(controller.register({
            email: 'corp@example.com',
            password: '123456',
            customerType: 'CORPORATE',
        })).rejects.toBeInstanceOf(common_1.UnauthorizedException);
    });
});
//# sourceMappingURL=customer-auth.controller.spec.js.map