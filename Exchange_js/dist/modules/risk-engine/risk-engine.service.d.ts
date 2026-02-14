export declare class RiskEngineService {
    private readonly logger;
    evaluate(context: any): Promise<{
        decision: 'APPROVE' | 'REJECT' | 'CHALLENGE';
        reason?: string;
    }>;
}
