import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { WithdrawTransactionQueryDto, UpdateWithdrawTransactionStatusDto, CreateWithdrawTransactionDto } from './dto/withdraw-transaction.dto';
export declare class WithdrawTransactionsController {
    private readonly service;
    private readonly onboardingService;
    constructor(service: WithdrawTransactionsService, onboardingService: OnboardingService);
    findMy(req: any, query: WithdrawTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findAll(query: WithdrawTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    create(req: any, dto: CreateWithdrawTransactionDto): Promise<any>;
    createMock(): Promise<any[]>;
    findOne(id: string): Promise<any>;
    updateStatus(id: string, dto: UpdateWithdrawTransactionStatusDto): Promise<any>;
}
