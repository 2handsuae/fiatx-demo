import { DepositTransactionsService } from './deposit-transactions.service';
import { DepositTransactionQueryDto, UpdateDepositTransactionStatusDto } from './dto/deposit-transaction.dto';
export declare class DepositTransactionsController {
    private readonly service;
    constructor(service: DepositTransactionsService);
    findMy(req: any, query: DepositTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findAll(query: DepositTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    create(): Promise<any>;
    updateStatus(id: string, dto: UpdateDepositTransactionStatusDto): Promise<any>;
    export(query: DepositTransactionQueryDto): Promise<any>;
}
