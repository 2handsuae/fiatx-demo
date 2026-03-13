import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { PricingSourceSide } from '../types/pricing.types';

export interface ExternalRateResult {
  rate: Prisma.Decimal;
  fetchedAt: Date;
  symbol: string;
  bid: string;
  ask: string;
  sideUsed: PricingSourceSide;
  aedPegApplied: boolean;
  aedPegRate: string;
  formula: string;
}

interface BookTickerSnapshot {
  symbol: string;
  bid: Prisma.Decimal;
  ask: Prisma.Decimal;
  fetchedAt: Date;
  expiresAt: number;
}

@Injectable()
export class BinanceRateProvider {
  private readonly logger = new Logger(BinanceRateProvider.name);
  private readonly aedUsdRate = new Prisma.Decimal('3.6725');
  private readonly cacheTtlMs = 3000;
  private readonly bookTickerCache = new Map<string, BookTickerSnapshot>();

  private normalizeSymbol(code: string): string {
    const upper = String(code || '').toUpperCase();
    if (upper === 'AED' || upper === 'USD') {
      return 'USDT';
    }
    return upper;
  }

  private async fetchBookTicker(symbol: string): Promise<BookTickerSnapshot | null> {
    const nowMs = Date.now();
    const cached = this.bookTickerCache.get(symbol);
    if (cached && cached.expiresAt > nowMs) {
      return cached;
    }

    try {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`,
        { timeout: 6000 },
      );
      const rawBid = response?.data?.bidPrice;
      const rawAsk = response?.data?.askPrice;
      if (rawBid === undefined || rawBid === null || rawAsk === undefined || rawAsk === null) {
        return null;
      }

      const bid = new Prisma.Decimal(rawBid);
      const ask = new Prisma.Decimal(rawAsk);
      if (bid.lte(0) || ask.lte(0)) {
        return null;
      }

      const fetchedAt = new Date();
      const next: BookTickerSnapshot = {
        symbol,
        bid,
        ask,
        fetchedAt,
        expiresAt: fetchedAt.getTime() + this.cacheTtlMs,
      };
      this.bookTickerCache.set(symbol, next);
      return next;
    } catch (error) {
      this.logger.debug(`Binance bookTicker fetch failed for ${symbol}: ${String(error)}`);
      return null;
    }
  }

  async fetchRate(fromCode: string, toCode: string): Promise<ExternalRateResult> {
    const fromUpper = String(fromCode || '').toUpperCase();
    const toUpper = String(toCode || '').toUpperCase();
    const normalizedFrom = this.normalizeSymbol(fromCode);
    const normalizedTo = this.normalizeSymbol(toCode);

    let symbol = `${normalizedFrom}${normalizedTo}`;
    let sideUsed: PricingSourceSide = 'BID';
    let bid = new Prisma.Decimal(1);
    let ask = new Prisma.Decimal(1);
    let fetchedAt = new Date();
    let formula = 'baseRate = 1 (same normalized quote asset)';
    let rate = new Prisma.Decimal(1);

    if (fromUpper !== toUpper && normalizedFrom !== normalizedTo) {
      const directSymbol = `${normalizedFrom}${normalizedTo}`;
      const inverseSymbol = `${normalizedTo}${normalizedFrom}`;

      const directTicker = await this.fetchBookTicker(directSymbol);
      if (directTicker) {
        symbol = directSymbol;
        sideUsed = 'BID';
        bid = directTicker.bid;
        ask = directTicker.ask;
        fetchedAt = directTicker.fetchedAt;
        rate = directTicker.bid;
        formula = `baseRate = bid(${directSymbol})`;
      } else {
        const inverseTicker = await this.fetchBookTicker(inverseSymbol);
        if (!inverseTicker || inverseTicker.ask.lte(0)) {
          throw new Error(`Binance rate unavailable for ${fromCode}/${toCode}`);
        }

        symbol = inverseSymbol;
        sideUsed = 'INVERSE_ASK';
        bid = inverseTicker.bid;
        ask = inverseTicker.ask;
        fetchedAt = inverseTicker.fetchedAt;
        rate = new Prisma.Decimal(1).div(inverseTicker.ask);
        formula = `baseRate = 1 / ask(${inverseSymbol})`;
      }
    }

    let aedPegApplied = false;
    if (fromUpper === 'AED') {
      rate = rate.div(this.aedUsdRate);
      aedPegApplied = true;
      formula = `${formula} / ${this.aedUsdRate.toString()} (from AED)`;
    }
    if (toUpper === 'AED') {
      rate = rate.mul(this.aedUsdRate);
      aedPegApplied = true;
      formula = `${formula} * ${this.aedUsdRate.toString()} (to AED)`;
    }

    return {
      rate,
      fetchedAt,
      symbol,
      bid: bid.toString(),
      ask: ask.toString(),
      sideUsed,
      aedPegApplied,
      aedPegRate: this.aedUsdRate.toString(),
      formula,
    };
  }
}
