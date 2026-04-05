import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  SumsubApplicantResponse,
  SumsubApplicantReviewStatusResponse,
  SumsubCreateApplicantInput,
  SumsubCreateSdkTokenInput,
  SumsubSdkTokenResponse,
} from './sumsub.types';

@Injectable()
export class SumsubClient {
  private readonly baseUrl = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
  private readonly http: AxiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  async createApplicant(input: SumsubCreateApplicantInput): Promise<SumsubApplicantResponse> {
    return this.post<SumsubApplicantResponse>(
      `/resources/applicants?levelName=${encodeURIComponent(input.levelName)}`,
      { externalUserId: input.externalUserId },
    );
  }

  async createSdkToken(input: SumsubCreateSdkTokenInput): Promise<SumsubSdkTokenResponse> {
    return this.post<SumsubSdkTokenResponse>('/resources/accessTokens/sdk', {
      userId: input.externalUserId,
      levelName: input.levelName,
      ttlInSecs: 600,
    });
  }

  async getApplicantReviewStatus(
    applicantId: string,
  ): Promise<SumsubApplicantReviewStatusResponse> {
    return this.get(`/resources/applicants/${applicantId}/status`);
  }

  async changeLevel(applicantId: string, levelName: string): Promise<Record<string, never>> {
    return this.post<Record<string, never>>(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      {},
    );
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
