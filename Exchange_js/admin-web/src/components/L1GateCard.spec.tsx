import { render, screen } from '@testing-library/react';
import L1GateCard from './L1GateCard';

const snapshot = JSON.stringify({
  evaluatedAt: '2026-08-22T10:00:00.000Z',
  domain: 'DEPOSIT',
  verdict: 'HOLD',
  holdReason: 'CAPABILITY_RESTRICTED',
  tradingTier: 'PREMIUM',
  checks: [
    { code: 'CUSTOMER_ELIGIBILITY', outcome: 'PASS', detail: '客户生命周期 ACTIVE' },
    { code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: '客户被限制账摁住 DEPOSIT 能力' },
    { code: 'CUMULATIVE_LIMIT', outcome: 'NA', detail: '本域不适用' },
  ],
});

describe('L1GateCard', () => {
  it('逐项渲染判定与人话说明', () => {
    render(<L1GateCard raw={snapshot} />);
    expect(screen.getByText('CUSTOMER_RESTRICTION')).toBeInTheDocument();
    expect(screen.getByText('客户被限制账摁住 DEPOSIT 能力')).toBeInTheDocument();
  });

  it('显示 verdict 与挂起原因与档位', () => {
    render(<L1GateCard raw={snapshot} />);
    expect(screen.getByText('HOLD')).toBeInTheDocument();
    expect(screen.getByText(/CAPABILITY_RESTRICTED/)).toBeInTheDocument();
    expect(screen.getByText(/PREMIUM/)).toBeInTheDocument();
  });

  it('快照为空时显示未评估,不崩', () => {
    render(<L1GateCard raw={null} />);
    expect(screen.getByText(/未评估|Not evaluated/)).toBeInTheDocument();
  });

  it('快照是坏 JSON 时降级显示原文,不崩', () => {
    render(<L1GateCard raw={'{ 坏掉的' } />);
    expect(screen.getByText(/无法解析|unparseable/i)).toBeInTheDocument();
  });
});
