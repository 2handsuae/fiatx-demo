import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateAssetDto, AssetStatus } from './dto/asset.dto';
import { Prisma } from '@prisma/client';
export declare class AssetsService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    create(data: CreateAssetDto): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        type: string;
        code: string;
        network: string | null;
        decimals: number;
        assetNo: string | null;
    }>;
    findAll(params: {
        skip?: number;
        take?: number;
        where?: Prisma.AssetWhereInput;
        orderBy?: Prisma.AssetOrderByWithRelationInput;
    }): Promise<{
        items: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            type: string;
            code: string;
            network: string | null;
            decimals: number;
            assetNo: string | null;
        }[];
        total: number;
    }>;
    findOne(id: string): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        type: string;
        code: string;
        network: string | null;
        decimals: number;
        assetNo: string | null;
    }>;
    changeStatus(id: string, status: AssetStatus): Promise<{
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        type: string;
        code: string;
        network: string | null;
        decimals: number;
        assetNo: string | null;
    }>;
}
