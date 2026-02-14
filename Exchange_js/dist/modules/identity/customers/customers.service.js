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
exports.CustomersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../core/prisma/prisma.service");
let CustomersService = class CustomersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(data) {
        return this.prisma.customerMain.create({
            data,
        });
    }
    async findAll(params) {
        const { skip, take, cursor, where, orderBy } = params;
        const [data, total] = await this.prisma.$transaction([
            this.prisma.customerMain.findMany({
                skip,
                take,
                cursor,
                where,
                orderBy,
            }),
            this.prisma.customerMain.count({ where }),
        ]);
        return { data, total };
    }
    async findOne(id) {
        return this.prisma.customerMain.findUnique({
            where: { id },
            include: {
                wallets: {
                    include: {
                        asset: true,
                    },
                },
                corporateProfile: true,
                uboProfiles: {
                    orderBy: { createdAt: 'asc' },
                },
                cddCases: {
                    orderBy: { createdAt: 'desc' },
                    take: 30,
                },
                eddCases: {
                    orderBy: { createdAt: 'desc' },
                    take: 30,
                },
                onboardingAuditLogs: {
                    orderBy: { createdAt: 'desc' },
                    take: 100,
                },
            },
        });
    }
    async update(params) {
        const { where, data } = params;
        return this.prisma.customerMain.update({
            data,
            where,
        });
    }
    async remove(where) {
        return this.prisma.customerMain.delete({
            where,
        });
    }
    async changeStatus(_id, _newStatus, _operatorId, _reason) {
        throw new common_1.BadRequestException('Deprecated endpoint. Use /onboarding/* (customer) and /admin/compliance/* (admin).');
    }
};
exports.CustomersService = CustomersService;
exports.CustomersService = CustomersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CustomersService);
//# sourceMappingURL=customers.service.js.map