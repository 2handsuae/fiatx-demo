import { adminFetch, getApiErrorMessage } from './adminFetch';

export const DELETE_REQUEST_TARGET_TYPES = {
  CHANGE_TICKET: 'CHANGE_TICKET',
  ADMIN_USER: 'ADMIN_USER',
  AUDIT_EVIDENCE_PACKAGE: 'AUDIT_EVIDENCE_PACKAGE',
} as const;

export type DeleteRequestTargetType =
  (typeof DELETE_REQUEST_TARGET_TYPES)[keyof typeof DELETE_REQUEST_TARGET_TYPES];

export interface CreateDeleteRequestInput {
  targetType: DeleteRequestTargetType;
  targetNo: string;
  deleteReason: string;
  docRef?: string;
}

export interface DeleteRequestSummary {
  id: string;
  requestNo: string;
  targetType: string;
  targetNo: string;
  status: string;
  traceId: string;
}

export const createDeleteRequest = async (
  input: CreateDeleteRequestInput,
): Promise<DeleteRequestSummary> => {
  const targetNo = input.targetNo.trim();
  const deleteReason = input.deleteReason.trim();
  const docRef = input.docRef?.trim();
  if (!targetNo || !deleteReason) {
    throw new Error('Target No and delete reason are required.');
  }

  const payload: Record<string, string> = {
    targetType: input.targetType,
    targetNo,
    deleteReason,
  };

  if (docRef) {
    payload.docRef = docRef;
  }

  const response = await adminFetch(
    `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Failed to create delete request.'));
  }

  return (await response.json()) as DeleteRequestSummary;
};
