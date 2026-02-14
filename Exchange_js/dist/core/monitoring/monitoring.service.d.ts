export declare enum AlertSeverity {
    INFO = "INFO",
    WARNING = "WARNING",
    ERROR = "ERROR",
    CRITICAL = "CRITICAL"
}
export declare class MonitoringService {
    private readonly logger;
    alert(title: string, message: string, severity?: AlertSeverity, metadata?: any): void;
    logMetric(name: string, value: number, tags?: Record<string, string>): void;
}
