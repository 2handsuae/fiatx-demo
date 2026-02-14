export declare enum CoaType {
    ASSET = "ASSET",
    LIABILITY = "LIABILITY",
    EQUITY = "EQUITY",
    REVENUE = "REVENUE",
    EXPENSE = "EXPENSE"
}
export declare enum CoaStatus {
    ACTIVE = "ACTIVE",
    DISABLED = "DISABLED"
}
export declare class CreateCoaDto {
    code: string;
    type: CoaType;
    name: string;
    status: CoaStatus;
    requiredTags?: string[];
}
export declare class UpdateCoaDto {
    name?: string;
    status?: CoaStatus;
    requiredTags?: string[];
}
export declare class CoaQueryDto {
    skip?: string;
    take?: string;
    code?: string;
    name?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
