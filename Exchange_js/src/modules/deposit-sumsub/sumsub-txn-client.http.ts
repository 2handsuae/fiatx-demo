import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import { SumsubTxnClient, SubmitTxnInput } from './sumsub-txn-client.interface';
import { SumsubTxnDetail, KytVerdict } from './sumsub-txn.types';

interface SumsubKytTxnResponse {
  id: string;
  typedTags?: { label: string; type: 'system' | 'userDefined' }[];
  review?: {
    reviewResult?: {
      reviewAnswer?: 'GREEN' | 'RED';
    };
  };
  scoringResult?: {
    action?: KytVerdict;
  };
}

/**
 * 生产实现:真调 Sumsub KYT Transaction Monitoring API。
 * 签名范式复刻 src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts
 * 的 buildHeaders(X-App-Token HMAC-SHA256:ts+method+path+body),该文件不做改动。
 */
@Injectable()
export class HttpSumsubTxnClient implements SumsubTxnClient {
  private readonly baseUrl = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
  private readonly http: AxiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  async submitTxn(input: SubmitTxnInput): Promise<{ txnId: string }> {
    const path = `/resources/applicants/${input.applicantId}/kyt/txns/-/data`;
    const body: Record<string, unknown> = {
      txnId: input.clientTxnId,
      type: input.type,
      info: {
        direction: input.direction,
        amount: input.amount,
        currencyCode: input.currencyCode,
        currencyType: input.currencyType,
      },
      applicant: {},
    };

    if (input.counterparty) {
      const counterparty: Record<string, unknown> = {};
      if (input.counterparty.fullName) {
        counterparty.fullName = input.counterparty.fullName;
      }
      if (input.counterparty.accountId) {
        counterparty.paymentMethod = { accountId: input.counterparty.accountId };
      }
      body.counterparty = counterparty;
    }

    const data = await this.post<SumsubKytTxnResponse>(path, body);
    return { txnId: data.id };
  }

  async getTxn(txnId: string): Promise<SumsubTxnDetail> {
    const path = `/resources/kyt/txns/${txnId}/one`;
    const data = await this.get<SumsubKytTxnResponse>(path);

    return {
      txnId,
      verdict: this.resolveVerdict(data),
      reviewAnswer: data.review?.reviewResult?.reviewAnswer ?? null,
      typedTags: data.typedTags ?? [],
    };
  }

  async rescore(txnId: string): Promise<void> {
    await this.post(`/resources/kyt/txns/${txnId}/-/score`, {});
  }

  async reviewComplete(txnId: string, answer: 'GREEN' | 'RED'): Promise<void> {
    await this.post(`/resources/kyt/txns/${txnId}/review/status/completed`, { reviewAnswer: answer });
  }

  /**
   * officer 终裁(review.reviewResult.reviewAnswer)优先于规则评分(scoringResult.action)。
   */
  private resolveVerdict(data: SumsubKytTxnResponse): KytVerdict {
    const reviewAnswer = data.review?.reviewResult?.reviewAnswer;
    if (reviewAnswer === 'GREEN') {
      return 'approved';
    }
    if (reviewAnswer === 'RED') {
      return 'rejected';
    }
    return data.scoringResult?.action as KytVerdict;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.http.get<T>(path, { headers: this.buildHeaders('GET', path) });
    return response.data;
  }

  private async post<T>(path: string, data: Record<string, unknown>): Promise<T> {
    const response = await this.http.post<T>(path, data, { headers: this.buildHeaders('POST', path, data) });
    return response.data;
  }

  private buildHeaders(method: string, path: string, body?: Record<string, unknown>) {
    const { appToken, secretKey } = this.requireCredentials();
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = `${ts}${method.toUpperCase()}${path}${body ? JSON.stringify(body) : ''}`;
    const sig = createHmac('sha256', secretKey).update(payload).digest('hex');

    return {
      'X-App-Token': appToken,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': sig,
    } satisfies Record<string, string>;
  }

  private requireCredentials(): { appToken: string; secretKey: string } {
    const appToken = process.env.SUMSUB_APP_TOKEN;
    const secretKey = process.env.SUMSUB_SECRET_KEY;
    const missing = [
      !appToken ? 'SUMSUB_APP_TOKEN' : null,
      !secretKey ? 'SUMSUB_SECRET_KEY' : null,
    ].filter((value): value is string => value !== null);

    if (missing.length > 0) {
      throw new Error(`Sumsub credentials are missing: ${missing.join(', ')}`);
    }

    return { appToken: appToken!, secretKey: secretKey! };
  }
}
