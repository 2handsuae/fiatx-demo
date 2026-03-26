import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { ComplianceAlertAction } from '../constants/compliance-alert-rules.constant';
import { UpdateComplianceAlertWorkItemDto } from './compliance-alert.dto';

describe('UpdateComplianceAlertWorkItemDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdateComplianceAlertWorkItemDto,
    data: '',
  };

  it('accepts assign payload', async () => {
    const result = await pipe.transform(
      {
        action: ComplianceAlertAction.ASSIGN,
        assigneeUserId: 'admin-1',
        reason: 'manual assignment',
      },
      metadata,
    );

    expect(result).toEqual({
      action: ComplianceAlertAction.ASSIGN,
      assigneeUserId: 'admin-1',
      reason: 'manual assignment',
    });
  });

  it('rejects non-work-item action codes', async () => {
    await expect(
      pipe.transform(
        {
          action: ComplianceAlertAction.CLOSE,
        },
        metadata,
      ),
    ).rejects.toThrow();
  });

  it('rejects legacy workflow fields on public action payload', async () => {
    try {
      await pipe.transform(
        {
          action: ComplianceAlertAction.ASSIGN,
          decision: 'CLEAR',
        },
        metadata,
      );
      throw new Error('Expected validation to fail for legacy workflow field.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          message: expect.arrayContaining(['property decision should not exist']),
        }),
      );
    }
  });
});
