import {
  toBusinessDate,
  endOfBusinessDate,
  startOfBusinessDate,
  businessMonthOf,
  startOfBusinessMonth,
  endOfBusinessMonth,
} from './business-date.util';

describe('business-date.util（迪拜午夜切）', () => {
  it('UTC 19:59:59.999 仍属当日业务日', () => {
    expect(toBusinessDate(new Date('2026-09-21T19:59:59.999Z'))).toBe('2026-09-21');
  });
  it('UTC 20:00:00.000 已属次日业务日（迪拜零点）', () => {
    expect(toBusinessDate(new Date('2026-09-21T20:00:00.000Z'))).toBe('2026-09-22');
  });
  it('迪拜凌晨归当日——修 UTC 切日把迪拜 1/5 02:00 记成 1/4 的病（BACKLOG:136 原文场景）', () => {
    expect(toBusinessDate(new Date('2026-01-04T22:00:00.000Z'))).toBe('2026-01-05');
  });
  it('endOfBusinessDate = D T19:59:59.999Z', () => {
    expect(endOfBusinessDate('2026-09-21').toISOString()).toBe('2026-09-21T19:59:59.999Z');
  });
  it('startOfBusinessDate = (D-1) T20:00:00.000Z', () => {
    expect(startOfBusinessDate('2026-09-21').toISOString()).toBe('2026-09-20T20:00:00.000Z');
  });
  it('三函数闭环：日始/日终归属 D，日终 +1ms 归属 D+1', () => {
    expect(toBusinessDate(startOfBusinessDate('2026-09-21'))).toBe('2026-09-21');
    expect(toBusinessDate(endOfBusinessDate('2026-09-21'))).toBe('2026-09-21');
    expect(toBusinessDate(new Date(endOfBusinessDate('2026-09-21').getTime() + 1))).toBe('2026-09-22');
  });
});

describe('business month helpers', () => {
  it('businessMonthOf: 迪拜 10-01 00:30 (UTC 09-30 20:30) 归 10 月', () => {
    expect(businessMonthOf(new Date('2026-09-30T20:30:00.000Z'))).toBe('2026-10');
  });
  it('businessMonthOf: UTC 09-30 19:59 仍归 9 月', () => {
    expect(businessMonthOf(new Date('2026-09-30T19:59:59.999Z'))).toBe('2026-09');
  });
  it('start/end 闭环：9 月窗口首尾互证', () => {
    expect(startOfBusinessMonth('2026-09').toISOString()).toBe('2026-08-31T20:00:00.000Z');
    expect(endOfBusinessMonth('2026-09').toISOString()).toBe('2026-09-30T19:59:59.999Z');
    expect(businessMonthOf(startOfBusinessMonth('2026-09'))).toBe('2026-09');
    expect(businessMonthOf(endOfBusinessMonth('2026-09'))).toBe('2026-09');
  });
  it('endOfBusinessMonth 处理 2 月与 12 月卷年', () => {
    expect(endOfBusinessMonth('2026-02').toISOString()).toBe('2026-02-28T19:59:59.999Z');
    expect(endOfBusinessMonth('2026-12').toISOString()).toBe('2026-12-31T19:59:59.999Z');
  });
});
