"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReferenceNo = generateReferenceNo;
function generateReferenceNo(prefix) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
    return `${prefix}${year}${month}${day}${random}`;
}
//# sourceMappingURL=no-generator.util.js.map