import { LiquidityProvidersService } from './liquidity-providers.service';
import { CreateLiquidityProviderDto, UpdateLiquidityProviderStatusDto } from './dto/liquidity-provider.dto';
export declare class LiquidityProvidersController {
    private readonly service;
    constructor(service: LiquidityProvidersService);
    create(dto: CreateLiquidityProviderDto): Promise<{
        name: string;
        id: string;
        email: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        phone: string | null;
    }>;
    findAll(skip?: string, take?: string, search?: string, status?: string): Promise<{
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
    changeStatus(id: string, dto: UpdateLiquidityProviderStatusDto): Promise<{
        name: string;
        id: string;
        email: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        phone: string | null;
    }>;
}
