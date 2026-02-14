export declare enum DrCr {
    DR = "DR",
    CR = "CR"
}
export declare class JournalLineQueryDto {
    skip?: string;
    take?: string;
    id?: string;
    journalId?: string;
    journalNo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
