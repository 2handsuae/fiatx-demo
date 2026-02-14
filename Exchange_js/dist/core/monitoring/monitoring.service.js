"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MonitoringService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringService = exports.AlertSeverity = void 0;
const common_1 = require("@nestjs/common");
var AlertSeverity;
(function (AlertSeverity) {
    AlertSeverity["INFO"] = "INFO";
    AlertSeverity["WARNING"] = "WARNING";
    AlertSeverity["ERROR"] = "ERROR";
    AlertSeverity["CRITICAL"] = "CRITICAL";
})(AlertSeverity || (exports.AlertSeverity = AlertSeverity = {}));
let MonitoringService = MonitoringService_1 = class MonitoringService {
    constructor() {
        this.logger = new common_1.Logger(MonitoringService_1.name);
    }
    alert(title, message, severity = AlertSeverity.ERROR, metadata) {
        const alertData = {
            timestamp: new Date().toISOString(),
            title,
            message,
            severity,
            metadata,
        };
        this.logger.error(`[ALERT][${severity}] ${title}: ${message}`, JSON.stringify(metadata));
        if (severity === AlertSeverity.CRITICAL) {
            console.error('!!! CRITICAL ALERT !!!', alertData);
        }
    }
    logMetric(name, value, tags) {
        this.logger.log(`[METRIC] ${name}=${value} ${JSON.stringify(tags || {})}`);
    }
};
exports.MonitoringService = MonitoringService;
exports.MonitoringService = MonitoringService = MonitoringService_1 = __decorate([
    (0, common_1.Injectable)()
], MonitoringService);
//# sourceMappingURL=monitoring.service.js.map