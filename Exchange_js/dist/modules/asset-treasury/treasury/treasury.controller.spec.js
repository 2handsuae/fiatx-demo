"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const treasury_controller_1 = require("./treasury.controller");
const treasury_service_1 = require("./treasury.service");
describe('TreasuryController', () => {
    let controller;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            controllers: [treasury_controller_1.TreasuryController],
            providers: [
                {
                    provide: treasury_service_1.TreasuryService,
                    useValue: {
                        getCustomerAssets: jest.fn(),
                    },
                },
            ],
        }).compile();
        controller = module.get(treasury_controller_1.TreasuryController);
    });
    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
//# sourceMappingURL=treasury.controller.spec.js.map