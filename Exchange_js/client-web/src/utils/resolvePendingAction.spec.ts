// client-web/src/utils/resolvePendingAction.spec.ts

import { resolvePendingAction } from './resolvePendingAction';

/**
 * resolvePendingAction is PendingActionBanner's single "what does this
 * response mean" decision point. The guarantee under test: every failure
 * shape (non-2xx, unparsable body) must throw — never resolve to a value
 * the caller could mistake for "leave the banner as-is". The caller
 * (PendingActionBanner.load) relies on that to funnel every failure into
 * one setAction(null) call.
 */
describe('resolvePendingAction', () => {
  it('returns the parsed action for a 200 with a JSON body', async () => {
    const res = new Response(JSON.stringify({ externalActionId: 'abc', reason: 'soft-line' }), {
      status: 200,
    });
    await expect(resolvePendingAction(res)).resolves.toEqual({
      externalActionId: 'abc',
      reason: 'soft-line',
    });
  });

  it('returns null for a body-less 200 (NestJS bare `return null`)', async () => {
    const res = new Response('', { status: 200 });
    await expect(resolvePendingAction(res)).resolves.toBeNull();
  });

  it('returns null for an explicit JSON null body', async () => {
    const res = new Response('null', { status: 200 });
    await expect(resolvePendingAction(res)).resolves.toBeNull();
  });

  // Finding 1: a non-2xx response is a failure, not "nothing to report" —
  // it must throw so PendingActionBanner's catch block clears the banner
  // instead of silently leaving a stale one on screen.
  it.each([500, 502, 503])(
    'throws for a non-2xx (%d) response instead of resolving to null-as-success',
    async (status) => {
      const res = new Response('', { status });
      await expect(resolvePendingAction(res)).rejects.toThrow();
    },
  );

  it('throws for a 200 with an unparsable body', async () => {
    const res = new Response('not-json', { status: 200 });
    await expect(resolvePendingAction(res)).rejects.toThrow();
  });
});
