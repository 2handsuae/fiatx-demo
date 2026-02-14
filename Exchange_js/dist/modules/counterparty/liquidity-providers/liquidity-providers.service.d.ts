import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateLiquidityProviderDto, LiquidityProviderStatus } from './dto/liquidity-provider.dto';
import { Prisma } from '@prisma/client';
export declare class LiquidityProvidersService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    create(data: CreateLiquidityProviderDto): Promise<{
        name: string;
        id: string;
        email: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        phone: string | null;
    }>;
    findAll(params: {
        skip?: number;
        take?: number;
        where?: Prisma.LiquidityProviderWhereInput;
        orderBy?: Prisma.LiquidityProviderOrderByWithRelationInput;
    }): Promise<{
        items: {
            name: string;
            id: string;
            email: string | null;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            phone: string | null;
        }[];
        total: number;
    }>;
    findOne(id: string): Promise<{
        name: string;
        id: string;
        email: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        phone: string | null;
    } | null>;
    changeStatus(id: string, status: LiquidityProviderStatus): Promise<{
        name: string;
        id: string;
        email: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        phone: string | null;
    }>;
}
