export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface InvitationSummaryLike {
  inviteExpiresAt: string;
  inviteStatus: string;
  inviteLink?: string;
}

type StoredInvitationLink = {
  memberId: string;
  inviteLink: string;
  inviteExpiresAt: string;
  inviteStatus: string;
};

const INVITATION_LINK_STORAGE_KEY = 'platform-members:fresh-invitation-link';

const resolveStorage = (storage?: StorageLike | null): StorageLike | null => {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const isPendingInvitationUsable = (invitation?: InvitationSummaryLike | null) => {
  if (!invitation || invitation.inviteStatus !== 'PENDING') {
    return false;
  }

  const expiresAt = new Date(invitation.inviteExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }

  return expiresAt.getTime() > Date.now();
};

const clearRawRecord = (storage?: StorageLike | null) => {
  const target = resolveStorage(storage);
  target?.removeItem(INVITATION_LINK_STORAGE_KEY);
};

export const readMemberInvitationLink = (
  storage?: StorageLike | null,
): StoredInvitationLink | null => {
  const target = resolveStorage(storage);
  if (!target) {
    return null;
  }

  try {
    const raw = target.getItem(INVITATION_LINK_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      clearRawRecord(target);
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    const record: StoredInvitationLink = {
      memberId: typeof candidate.memberId === 'string' ? candidate.memberId : '',
      inviteLink:
        typeof candidate.inviteLink === 'string' ? candidate.inviteLink.trim() : '',
      inviteExpiresAt:
        typeof candidate.inviteExpiresAt === 'string' ? candidate.inviteExpiresAt : '',
      inviteStatus:
        typeof candidate.inviteStatus === 'string' ? candidate.inviteStatus : '',
    };

    if (!record.memberId || !record.inviteLink || !isPendingInvitationUsable(record)) {
      clearRawRecord(target);
      return null;
    }

    return record;
  } catch {
    clearRawRecord(target);
    return null;
  }
};

export const clearMemberInvitationLink = (
  storage?: StorageLike | null,
  memberId?: string,
) => {
  const target = resolveStorage(storage);
  if (!target) {
    return;
  }

  const current = readMemberInvitationLink(target);
  if (!current) {
    return;
  }

  if (memberId && current.memberId !== memberId) {
    return;
  }

  clearRawRecord(target);
};

export const persistMemberInvitationLink = (
  storage: StorageLike | null | undefined,
  memberId: string,
  invitation: InvitationSummaryLike,
): StoredInvitationLink | null => {
  const target = resolveStorage(storage);
  if (!target) {
    return null;
  }

  if (!memberId || !invitation.inviteLink || !isPendingInvitationUsable(invitation)) {
    clearMemberInvitationLink(target, memberId);
    return null;
  }

  const record: StoredInvitationLink = {
    memberId,
    inviteLink: invitation.inviteLink,
    inviteExpiresAt: invitation.inviteExpiresAt,
    inviteStatus: invitation.inviteStatus,
  };

  target.setItem(INVITATION_LINK_STORAGE_KEY, JSON.stringify(record));
  return record;
};

export const hydrateMemberInvitationLink = <T extends InvitationSummaryLike>(
  storage: StorageLike | null | undefined,
  memberId: string,
  invitation: T | null,
): T | null => {
  if (!invitation) {
    clearMemberInvitationLink(storage, memberId);
    return null;
  }

  if (!isPendingInvitationUsable(invitation)) {
    clearMemberInvitationLink(storage, memberId);
    return invitation;
  }

  if (invitation.inviteLink) {
    persistMemberInvitationLink(storage, memberId, invitation);
    return invitation;
  }

  const cached = readMemberInvitationLink(storage);
  if (!cached || cached.memberId !== memberId) {
    return invitation;
  }

  if (
    cached.inviteStatus !== invitation.inviteStatus ||
    cached.inviteExpiresAt !== invitation.inviteExpiresAt
  ) {
    clearMemberInvitationLink(storage, memberId);
    return invitation;
  }

  return {
    ...invitation,
    inviteLink: cached.inviteLink,
  };
};
