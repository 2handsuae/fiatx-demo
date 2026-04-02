import * as fs from 'fs';
import * as path from 'path';

describe('FeeOccurrence schema regression', () => {
  it('does not keep removed occurrence type or period fields in prisma schema', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const modelMatch = schema.match(
      /model FeeOccurrence \{([\s\S]*?)^\}/m,
    );

    expect(modelMatch).toBeTruthy();

    const modelBody = modelMatch?.[1] ?? '';
    expect(modelBody).not.toContain('occurrenceType');
    expect(modelBody).not.toContain('periodStart');
    expect(modelBody).not.toContain('periodEnd');
    expect(modelBody).not.toContain('@@index([feeType, occurrenceType])');
  });
});
