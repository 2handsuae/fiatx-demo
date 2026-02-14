"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const deposit_transactions_controller_1 = require("./deposit-transactions.controller");
const deposit_transactions_service_1 = require("./deposit-transactions.service");
describe('DepositTransactionsController', () => {
    let controller;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            controllers: [deposit_transactions_controller_1.DepositTransactionsController],
            providers: [
                {
                    provide: deposit_transactions_service_1.DepositTransactionsService,
                    useValue: {
                        findAll: jest.fn(),
                        findOne: jest.fn(),
                        updateStatus: jest.fn(),
                    },
                },
            ],
        }).compile();
        controller = module.get(deposit_transactions_controller_1.DepositTransactionsController);
    });
    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
//# sourceMappingURL=deposit-transactions.controller.spec.js.map