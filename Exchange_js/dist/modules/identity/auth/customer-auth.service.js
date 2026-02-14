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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerAuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = require("bcrypt");
const no_generator_util_1 = require("../../../common/utils/no-generator.util");
let CustomerAuthService = class CustomerAuthService {
    constructor(prisma, jwtService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
    }
    async register(data) {
        const existing = await this.prisma.customerMain.findUnique({
            where: { email: data.email },
        });
        if (existing) {
            throw new common_1.BadRequestException('Email already exists');
        }
        if (data.customerType === 'CORPORATE' && !data.companyName?.trim()) {
            throw new common_1.BadRequestException('companyName is required for corporate customer');
        }
        const passwordHash = await bcrypt.hash(data.password, 10);
        const customer = await this.prisma.customerMain.create({
            data: {
                customerNo: (0, no_generator_util_1.generateReferenceNo)('CU'),
                email: data.email,
                passwordHash,
                customerType: data.customerType,
                companyName: data.customerType === 'CORPORATE' ? data.companyName?.trim() || null : null,
                firstName: data.firstName,
                lastName: data.lastName,
                passwordUpdatedAt: new Date(),
            },
        });
        const { passwordHash: _, ...result } = customer;
        return result;
    }
    async validateCustomer(identifier, pass) {
        const normalized = (identifier || '').trim();
        if (!normalized)
            return null;
        const customer = await this.prisma.customerMain.findFirst({
            where: {
                OR: [{ email: normalized }, { phone: normalized }],
            },
        });
        if (!customer) {
            return null;
        }
        if (!customer.passwordHash) {
            return null;
        }
        if (customer.lockedUntil && customer.lockedUntil > new Date()) {
            throw new common_1.ForbiddenException('Account is locked. Try again later.');
        }
        else if (customer.lockedUntil && customer.lockedUntil <= new Date()) {
            await this.prisma.customerMain.update({
                where: { id: customer.id },
                data: { failedLoginCount: 0, lockedUntil: null },
            });
        }
        const isMatch = await bcrypt.compare(pass, customer.passwordHash);
        if (isMatch) {
            await this.prisma.customerMain.update({
                where: { id: customer.id },
                data: {
                    failedLoginCount: 0,
                    lockedUntil: null,
                    lastLoginAt: new Date(),
                },
            });
            const { passwordHash, ...result } = customer;
            return result;
        }
        else {
            const attempts = customer.failedLoginCount + 1;
            const updateData = { failedLoginCount: attempts };
            if (attempts >= 5) {
                updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
            }
            await this.prisma.customerMain.update({
                where: { id: customer.id },
                data: updateData,
            });
            return null;
        }
    }
    async login(customer) {
        const payload = {
            username: customer.email,
            sub: customer.id,
            role: 'CUSTOMER',
            type: 'CUSTOMER',
        };
        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: customer.id,
                email: customer.email,
                firstName: customer.firstName,
                lastName: customer.lastName,
            },
        };
    }
};
exports.CustomerAuthService = CustomerAuthService;
exports.CustomerAuthService = CustomerAuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService])
], CustomerAuthService);
//# sourceMappingURL=customer-auth.service.js.map