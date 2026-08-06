import axios, { AxiosInstance } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
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

  /**
   * Mock mode: when SUMSUB_APP_TOKEN/SUMSUB_SECRET_KEY are missing, return fake
   * data instead of calling the real Sumsub API. This lets dev/staging environments
   * drive the onboarding flow end-to-end using the admin simulation tool.
   */
  private get isMockMode(): boolean {
    return !process.env.SUMSUB_APP_TOKEN || !process.env.SUMSUB_SECRET_KEY;
  }

  async createApplicant(input: SumsubCreateApplicantInput): Promise<SumsubApplicantResponse> {
    if (this.isMockMode) {
      return { id: `MOCK-${input.externalUserId}` };
    }
    return this.post<SumsubApplicantResponse>(
      `/resources/applicants?levelName=${encodeURIComponent(input.levelName)}`,
      { externalUserId: input.externalUserId },
    );
  }

  async createSdkToken(input: SumsubCreateSdkTokenInput): Promise<SumsubSdkTokenResponse> {
    if (this.isMockMode) {
      return { token: `MOCK-SDK-TOKEN-${input.externalUserId}` };
    }
    return this.post<SumsubSdkTokenResponse>('/resources/accessTokens/sdk', {
      userId: input.externalUserId,
      levelName: input.levelName,
      ttlInSecs: 600,
    });
  }

  async getApplicantByExternalUserId(
    externalUserId: string,
  ): Promise<SumsubApplicantResponse | null> {
    if (this.isMockMode) {
      // Pretend no applicant exists so createApplicant() is called next.
      return null;
    }
    return this.getOptional<SumsubApplicantResponse>(
      `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`,
    );
  }

  async getApplicantReviewStatus(
    applicantId: string,
  ): Promise<SumsubApplicantReviewStatusResponse> {
    if (this.isMockMode) {
      return { reviewStatus: 'init' } as SumsubApplicantReviewStatusResponse;
    }
    return this.get(`/resources/applicants/${applicantId}/status`);
  }

  async changeLevel(applicantId: string, levelName: string): Promise<Record<string, never>> {
    if (this.isMockMode) {
      return {} as Record<string, never>;
    }
    return this.post<Record<string, never>>(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      {},
    );
  }

  // ─── Wave 3 mock-first methods (2026-04-09) ──────────────────────────────

  async runAmlCheck(applicantId: string): Promise<{ ok: number; inspectionId: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      const { randomUUID } = await import('crypto');
      return { ok: 1, inspectionId: `mock-insp-${randomUUID()}` };
    }
    return this.post(`/resources/applicants/${applicantId}/aml/check`, {});
  }

  async getApplicant(applicantId: string): Promise<any> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      return {
        id: applicantId,
        info: { idDocs: [] },
        riskLabels: [],
        tags: [],
        totalScore: null,
      };
    }
    return this.get(`/resources/applicants/${applicantId}/one`);
  }

  async createApplicantAction(input: {
    applicantId: string;
    levelName: string;
  }): Promise<{ id: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      const { randomUUID } = await import('crypto');
      return { id: `mock-action-${randomUUID()}` };
    }
    return this.post(
      `/resources/applicantActions/-/forApplicant/${input.applicantId}?levelName=${encodeURIComponent(input.levelName)}`,
      {},
    );
  }

  async createActionSdkToken(input: {
    applicantId: string;
    levelName: string;
    /**
     * applicant action 场景官方必填。可选是因为**材料重检那条流程的 action 是
     * 用 createApplicantAction 建的,而它 POST 的是 `{}`,从来没提交过
     * external id** —— 我方手里根本没有这个值,传 sumsubActionId 是传错类型
     * (那是 Sumsub 侧 id),会绑到不匹配的 action。该流程真接前需要先改成
     * 建 action 时就带上我方 external id,已登记 BACKLOG。
     */
    externalActionId?: string;
    ttlInSecs?: number;
  }): Promise<{ token: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      // ⚠️ 占位 token **不得从 externalActionId 派生**——哪怕是哈希。
      // fixture 的值域只有两个(EXT-SOF-0001 / EXT-EDD-0002),无盐确定性摘要
      // 在这个值域上是双射,客户对着两个候选各哈希一次就反推出 PEP 判定。
      // 这与当初判 materialKind 死刑是同一条推理,只是换成哈希载体。
      // 纯随机 = 零比特。真实 token 本身也是短时效、每次重取都不同的,
      // 所以"同一条 action 拿同一个 token"从来就不是真实语义,不必模拟。
      const { randomUUID } = await import('crypto');
      return { token: `mock-sdk-token-${randomUUID()}` };
    }
    return this.post('/resources/accessTokens/sdk', {
      // applicantId 是 Sumsub 侧 id，必须走这个字段；userId 是我方 externalUserId，
      // 两者不可混用（此前传的是 userId: applicantId，会绑到错的 applicant）。
      applicantId: input.applicantId,
      levelName: input.levelName,
      // applicant action 场景官方必填。
      // ⚠️ 判据用 `!== undefined` 而不是真值判断：调用方传 `''`（空串）说明
      // 它手里就是拿不到合法 external id，这本身是个错误状态，应该让这次
      // POST 照样带上空串发出去、由 Sumsub 明确报错，逼错误在真接时刻暴露。
      // 若改回真值判断（`input.externalActionId &&`），空串会被这里悄悄
      // 吞掉——铸出一个不绑任何 action 的 token，且没有任何报错，是静默
      // 降级而不是拒绝。真正“调用方就是不想传”的场景走的是 `undefined`
      // （字段整个不传，如 material-refresh-cycles.controller 那条调用），
      // 那种情况下这里也确实不该加进 body。
      ...(input.externalActionId !== undefined && { externalActionId: input.externalActionId }),
      ttlInSecs: input.ttlInSecs ?? 600,
    });
  }

  async moveToLevel(
    applicantId: string,
    levelName: string,
    docSets?: any[],
  ): Promise<any> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      return { ok: 1, levelName };
    }
    return this.post(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      docSets ? { docSets } : {},
    );
  }

  verifyWebhookSignature(
    rawBody?: Buffer,
    signature?: string,
    digestAlg?: string,
  ): boolean {
    if (!rawBody || rawBody.length === 0 || !signature) {
      return false;
    }

    const algorithm = this.resolveWebhookDigestAlgorithm(digestAlg);
    if (!algorithm) {
      return false;
    }

    const expected = createHmac(algorithm, this.requireWebhookSecretKey())
      .update(rawBody)
      .digest('hex');
    const normalizedSignature = signature.trim().toLowerCase();

    if (normalizedSignature.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(
      Buffer.from(normalizedSignature, 'utf8'),
      Buffer.from(expected, 'utf8'),
    );
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.http.get<T>(path, { headers: this.buildHeaders('GET', path) });
    return response.data;
  }

  private async getOptional<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 404) {
        return null;
      }
      throw error;
    }
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

  private resolveWebhookDigestAlgorithm(
    digestAlg?: string,
  ): 'sha1' | 'sha256' | 'sha512' | null {
    switch (String(digestAlg || '').trim().toUpperCase()) {
      case '':
      case 'HMAC_SHA256_HEX':
        return 'sha256';
      case 'HMAC_SHA1_HEX':
        return 'sha1';
      case 'HMAC_SHA512_HEX':
        return 'sha512';
      default:
        return null;
    }
  }

  private requireWebhookSecretKey(): string {
    const secretKey = process.env.SUMSUB_SECRET_KEY;
    if (!secretKey) {
      throw new Error('Sumsub webhook secret is missing: SUMSUB_SECRET_KEY');
    }
    return secretKey;
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
