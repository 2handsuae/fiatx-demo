import { shouldShowConfirmation } from './confirmationDisplay';

describe('shouldShowConfirmation', () => {
  it.each([
    ['SUCCESS', {}, true],
    ['SUCCESS', null, false],
    ['SUCCESS', undefined, false],
    // 纵深防御：后端万一漏带 confirmation，前端也不给非成功单出单
    ['COMPLIANCE_PENDING', {}, false],
    ['REJECTED', {}, false],
  ])('%s/%p → %p', (status, confirmation, want) => {
    expect(shouldShowConfirmation(status, confirmation)).toBe(want);
  });
});
