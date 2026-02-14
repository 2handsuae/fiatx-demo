import { AssetsService } from './assets.service';
import { CreateAssetDto, UpdateAssetStatusDto, AssetStatus, AssetType } from './dto/asset.dto';
export declare class AssetsController {
    private readonly service;
    constructor(service: AssetsService);
    create(dto: CreateAssetDto): Promise<{
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
    findAll(skip?: string, take?: string, type?: AssetType, status?: AssetStatus, code?: string): Promise<{
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
    changeStatus(id: string, dto: UpdateAssetStatusDto): Promise<{
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
