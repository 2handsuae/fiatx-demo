import {
  clearMemberInvitationLink,
  hydrateMemberInvitationLink,
  persistMemberInvitationLink,
  readMemberInvitationLink,
  type InvitationSummaryLike,
  type StorageLike,
} from './memberInvitationLinkCache';

const createMemoryStorage = (): StorageLike => {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
};

describe('memberInvitationLinkCache', () => {
  const futureExpiry = '2026-04-10T00:00:00.000Z';

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-04T00:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists a fresh pending invitation and hydrates the link back into summary data', () => {
    const storage = createMemoryStorage();
    const invitation: InvitationSummaryLike = {
      inviteLink: 'http://localhost:3001/admin/activate?token=fresh',
      inviteExpiresAt: futureExpiry,
      inviteStatus: 'PENDING',
    };

    persistMemberInvitationLink(storage, 'user-1', invitation);

    expect(readMemberInvitationLink(storage)).toEqual({
      memberId: 'user-1',
      inviteLink: 'http://localhost:3001/admin/activate?token=fresh',
      inviteExpiresAt: futureExpiry,
      inviteStatus: 'PENDING',
    });
    expect(
      hydrateMemberInvitationLink(storage, 'user-1', {
        inviteExpiresAt: futureExpiry,
        inviteStatus: 'PENDING',
      }),
    ).toEqual(invitation);
  });

  it('prunes expired records on read', () => {
    const storage = createMemoryStorage();

    persistMemberInvitationLink(storage, 'user-1', {
      inviteLink: 'http://localhost:3001/admin/activate?token=expired',
      inviteExpiresAt: '2026-04-03T00:00:00.000Z',
      inviteStatus: 'PENDING',
    });

    expect(readMemberInvitationLink(storage)).toBeNull();
  });

  it('does not hydrate when the cached memberId belongs to another member', () => {
    const storage = createMemoryStorage();

    persistMemberInvitationLink(storage, 'user-1', {
      inviteLink: 'http://localhost:3001/admin/activate?token=fresh',
      inviteExpiresAt: futureExpiry,
      inviteStatus: 'PENDING',
    });

    expect(
      hydrateMemberInvitationLink(storage, 'user-2', {
        inviteExpiresAt: futureExpiry,
        inviteStatus: 'PENDING',
      }),
    ).toEqual({
      inviteExpiresAt: futureExpiry,
      inviteStatus: 'PENDING',
    });
    expect(readMemberInvitationLink(storage)).toEqual({
      memberId: 'user-1',
      inviteLink: 'http://localhost:3001/admin/activate?token=fresh',
      inviteExpiresAt: futureExpiry,
      inviteStatus: 'PENDING',
    });
  });

  it.each([
    [
      'status mismatch',
      {
        inviteExpiresAt: futureExpiry,
        inviteStatus: 'USED',
      },
    ],
    [
      'expiry mismatch',
      {
        inviteExpiresAt: '2026-04-11T00:00:00.000Z',
        inviteStatus: 'PENDING',
      },
    ],
  ])(
    'clears cached invitation when %s is detected',
    (_label: string, summary: InvitationSummaryLike) => {
      const storage = createMemoryStorage();

      persistMemberInvitationLink(storage, 'user-1', {
        inviteLink: 'http://localhost:3001/admin/activate?token=fresh',
        inviteExpiresAt: futureExpiry,
      inviteStatus: 'PENDING',
    });

      expect(hydrateMemberInvitationLink(storage, 'user-1', summary)).toEqual(summary);
      expect(readMemberInvitationLink(storage)).toBeNull();
      clearMemberInvitationLink(storage, 'user-1');
      expect(readMemberInvitationLink(storage)).toBeNull();
    },
  );
});
