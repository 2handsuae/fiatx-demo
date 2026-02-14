"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerAuthController = void 0;
const common_1 = require("@nestjs/common");
const customer_auth_service_1 = require("./customer-auth.service");
const swagger_1 = require("@nestjs/swagger");
const zod_1 = require("zod");
const RegisterSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    customerType: zod_1.z.enum(['INDIVIDUAL', 'CORPORATE']),
    companyName: zod_1.z.string().trim().min(1).optional(),
    firstName: zod_1.z.string().optional(),
    lastName: zod_1.z.string().optional(),
}).superRefine((val, ctx) => {
    if (val.customerType === 'CORPORATE' && !val.companyName) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['companyName'],
            message: 'companyName is required for corporate customer',
        });
    }
});
const LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().min(4).optional(),
    password: zod_1.z.string().min(6),
}).refine((value) => !!value.email || !!value.phone, {
    message: 'email or phone is required',
});
let CustomerAuthController = class CustomerAuthController {
    constructor(customerAuthService) {
        this.customerAuthService = customerAuthService;
    }
    async register(body) {
        const result = RegisterSchema.safeParse(body);
        if (!result.success) {
            throw new common_1.UnauthorizedException('Invalid input format');
        }
        return this.customerAuthService.register(result.data);
    }
    async login(body) {
        const result = LoginSchema.safeParse(body);
        if (!result.success) {
            throw new common_1.UnauthorizedException('Invalid input format');
        }
        const identifier = body.email || body.phone;
        const customer = await this.customerAuthService.validateCustomer(identifier, body.password);
        if (!customer) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        return this.customerAuthService.login(customer);
    }
};
exports.CustomerAuthController = CustomerAuthController;
__decorate([
    (0, common_1.Post)('register'),
    (0, swagger_1.ApiOperation)({ summary: 'Register a new customer' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Login for customer' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Return JWT token' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "login", null);
exports.CustomerAuthController = CustomerAuthController = __decorate([
    (0, swagger_1.ApiTags)('auth-customer'),
    (0, common_1.Controller)('auth/customer'),
    __metadata("design:paramtypes", [customer_auth_service_1.CustomerAuthService])
], CustomerAuthController);
//# sourceMappingURL=customer-auth.controller.js.map