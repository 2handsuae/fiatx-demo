import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import { SumsubTxnClient, SubmitTxnInput, SumsubScoringResult } from './sumsub-txn-client.interface';
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
    score?: number;
    matchedRules?: { name?: string }[];
    applicantActions?: { applicantActionId?: string; externalActionId?: string }[];
  };
}

/**
 * 生产实现:真调 Sumsub KYT Transaction Monitoring API。
 * 签名范式复刻 src/modules/sumsub-applicant-client/sumsub.client.ts
 * 的 buildHeaders(X-App-Token HMAC-SHA256:ts+method+path+body),该文件不做改动。
 */
@Injectable()
export class HttpSumsubTxnClient implements SumsubTxnClient {
  private readonly baseUrl = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
  private readonly http: AxiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  async submitTxn(input: SubmitTxnInput): Promise<{ txnId: string; scoringResult?: SumsubScoringResult }> {
    const path = `/resources/applicants/${input.applicantId}/kyt/txns/-/data`;
    const info: Record<string, unknown> = {
      direction: input.direction,
      amount: input.amount,
      currencyCode: input.currencyCode,
      currencyType: input.currencyType,
    };
    if (input.infoType) {
      info.type = input.infoType;
    }

    const body: Record<string, unknown> = {
      txnId: input.clientTxnId,
      type: input.type,
      info,
      applicant: {},
    };

    if (input.orderId) {
      body.orderId = input.orderId;
    }
    if (input.props) {
      body.props = input.props;
    }

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
    return { txnId: data.id, scoringResult: this.resolveScoringResult(data) };
  }

  /**
   * 把 submitTxn 响应里的 scoringResult 映射成本模块的 SumsubScoringResult。
   * action 是必填的三态判别字段,若响应没给出可识别的 action(字段缺失/非预期取值),
   * 说明这份评分快照不可信,整体判 undefined 而非瞎猜——好过伪造一个 'score' 误导调用方。
   */
  private resolveScoringResult(data: SumsubKytTxnResponse): SumsubScoringResult | undefined {
    const raw = data.scoringResult;
    if (!raw || !this.isKnownScoringAction(raw.action)) {
      return undefined;
    }

    return {
      action: raw.action,
      score: raw.score,
      matchedRuleNames: Array.isArray(raw.matchedRules)
        ? raw.matchedRules.map((r) => r?.name).filter((name): name is string => Boolean(name))
        : [],
      applicantActions: Array.isArray(raw.applicantActions)
        ? raw.applicantActions.map((a) => ({
            applicantActionId: String(a?.applicantActionId ?? ''),
            externalActionId: String(a?.externalActionId ?? ''),
          }))
        : [],
    };
  }

  private isKnownScoringAction(action: unknown): action is SumsubScoringResult['action'] {
    return action === 'score' || action === 'onHold' || action === 'awaitUser' || action === 'reject';
  }

  async getTxn(txnId: string): Promise<SumsubTxnDetail> {
    const path = `/resources/kyt/txns/${txnId}/one`;
    const data = await this.get<SumsubKytTxnResponse>(path);

    return {
      txnId,
      verdict: this.resolveVerdict(data),
      reviewAnswer: data.review?.reviewResult?.reviewAnswer ?? null,
      riskScore: data.scoringResult?.score ?? null,
      typedTags: data.typedTags ?? [],
      applicantActions: Array.isArray(data?.scoringResult?.applicantActions)
        ? data.scoringResult.applicantActions.map((a: any) => ({
            applicantActionId: String(a.applicantActionId ?? ''),
            externalActionId: String(a.externalActionId ?? ''),
          }))
        : undefined,
      raw: data,
    };
  }

  async rescore(txnId: string): Promise<void> {
    await this.post(`/resources/kyt/txns/${txnId}/-/score`, {});
  }

  async reviewComplete(txnId: string, answer: 'GREEN' | 'RED'): Promise<void> {
    await this.post(`/resources/kyt/txns/${txnId}/review/status/completed`, { reviewAnswer: answer });
  }

  async archiveTxHash(txnId: string, txHash: string): Promise<void> {
    await this.patch(`/resources/kyt/txns/${txnId}/data/info`, {
      txnInfo: { cryptoTxInfo: { txHash } },
    });
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

  private async patch<T>(path: string, data: Record<string, unknown>): Promise<T> {
    const response = await this.http.patch<T>(path, data, { headers: this.buildHeaders('PATCH', path, data) });
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
