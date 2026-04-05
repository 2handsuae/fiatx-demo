import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  SumsubCreateApplicantInput,
  SumsubCreateSdkTokenInput,
} from './sumsub.types';

@Injectable()
export class SumsubClient {
  private readonly baseUrl = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
  private readonly appToken = process.env.SUMSUB_APP_TOKEN || '';
  private readonly secretKey = process.env.SUMSUB_SECRET_KEY || '';
  private readonly http: AxiosInstance = axios.create({
    baseURL: this.baseUrl,
    timeout: 10000,
  });

  async createApplicant(input: SumsubCreateApplicantInput) {
    return this.post(
      `/resources/applicants?levelName=${encodeURIComponent(input.levelName)}`,
      { externalUserId: input.externalUserId },
    );
  }

  async createSdkToken(input: SumsubCreateSdkTokenInput) {
    return this.post('/resources/accessTokens/sdk', {
      userId: input.applicantId,
      levelName: input.levelName,
      ttlInSecs: 600,
    });
  }

  async getApplicantReviewStatus(applicantId: string) {
    return this.get(`/resources/applicants/${applicantId}/requiredIdDocsStatus`);
  }

  async changeLevel(applicantId: string, levelName: string) {
    return this.post(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      {},
    );
  }

  private async get(path: string) {
    return this.http.get(path, { headers: this.buildHeaders('GET', path) });
  }

  private async post(path: string, data: Record<string, unknown>) {
    return this.http.post(path, data, { headers: this.buildHeaders('POST', path, data) });
  }

  private buildHeaders(method: string, path: string, body?: Record<string, unknown>) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = `${ts}${method.toUpperCase()}${path}${body ? JSON.stringify(body) : ''}`;
    const sig = createHmac('sha256', this.secretKey).update(payload).digest('hex');

    return {
      'X-App-Token': this.appToken,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': sig,
    } satisfies Record<string, string>;
  }
}
