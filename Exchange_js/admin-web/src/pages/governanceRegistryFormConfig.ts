import { toDateTimeLocalValue, toIsoDateTime, toPrettyJson } from '../components/governance/governanceUtils';
import {
  getRegistryConfig,
  getRegistryCreatePath,
  getRegistryDetailPath,
  getRegistryEditPath,
  getRegistryListPath,
  type RegistryType,
} from './governanceRegistryConfig';

export type ShareholdingParticipantFormState = {
  participantType: string;
  participantName: string;
  ownershipPercent: string;
  controlSummary: string;
  evidenceRef: string;
  metadataJson: string;
};

export type GovernanceRegistryFormState = {
  versionLabel: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
  supersedesId: string;
  evidenceRef: string;
  metadataJson: string;
  traceId: string;
  participants: ShareholdingParticipantFormState[];
  roleType: string;
  personName: string;
  regulatedFlag: boolean;
  proposedEffectiveAt: string;
  effectiveAt: string;
  endedAt: string;
  assignee: string;
  trainingType: string;
  dueAt: string;
  completedAt: string;
  waiverReason: string;
  disclosureType: string;
  disclosedByName: string;
  disclosedAt: string;
  reviewDueAt: string;
  mitigationSummary: string;
  closedAt: string;
  materialType: string;
  supersededAt: string;
};

export const SHAREHOLDING_PARTICIPANT_TYPE_OPTIONS = ['SHAREHOLDER', 'CONTROLLER', 'UBO'] as const;

export const emptyParticipant = (): ShareholdingParticipantFormState => ({
  participantType: 'SHAREHOLDER',
  participantName: '',
  ownershipPercent: '',
  controlSummary: '',
  evidenceRef: '',
  metadataJson: '{}',
});

export const createInitialRegistryFormState = (
  registryType: RegistryType,
): GovernanceRegistryFormState => ({
  versionLabel: '',
  status:
    registryType === 'shareholding-versions'
      ? 'DRAFT'
      : registryType === 'appointments'
        ? 'PLANNED'
        : registryType === 'trainings'
          ? 'ASSIGNED'
          : registryType === 'conflicts'
            ? 'OPEN'
            : 'ACTIVE',
  effectiveFrom: '',
  effectiveTo: '',
  supersedesId: '',
  evidenceRef: '',
  metadataJson: '{}',
  traceId: '',
  participants: registryType === 'shareholding-versions' ? [emptyParticipant()] : [],
  roleType: '',
  personName: '',
  regulatedFlag: false,
  proposedEffectiveAt: '',
  effectiveAt: '',
  endedAt: '',
  assignee: '',
  trainingType: '',
  dueAt: '',
  completedAt: '',
  waiverReason: '',
  disclosureType: '',
  disclosedByName: '',
  disclosedAt: '',
  reviewDueAt: '',
  mitigationSummary: '',
  closedAt: '',
  materialType: '',
  supersededAt: '',
});

const toJsonInputValue = (value: unknown) => toPrettyJson(value && typeof value === 'object' ? value : {});

export const hydrateRegistryFormState = (
  registryType: RegistryType,
  detail: Record<string, unknown>,
): GovernanceRegistryFormState => ({
  ...createInitialRegistryFormState(registryType),
  versionLabel: String(detail.versionLabel || ''),
  status: String(detail.status || createInitialRegistryFormState(registryType).status),
  effectiveFrom: toDateTimeLocalValue(detail.effectiveFrom as string | null),
  effectiveTo: toDateTimeLocalValue(detail.effectiveTo as string | null),
  supersedesId: '',
  evidenceRef: String(detail.evidenceRef || ''),
  metadataJson: toJsonInputValue(detail.metadataJson),
  traceId: String(detail.traceId || ''),
  participants:
    registryType === 'shareholding-versions'
      ? Array.isArray(detail.participants) && detail.participants.length > 0
        ? detail.participants.map((participant) => ({
            participantType: String((participant as Record<string, unknown>).participantType || 'SHAREHOLDER'),
            participantName: String((participant as Record<string, unknown>).participantName || ''),
            ownershipPercent: String((participant as Record<string, unknown>).ownershipPercent || ''),
            controlSummary: String((participant as Record<string, unknown>).controlSummary || ''),
            evidenceRef: String((participant as Record<string, unknown>).evidenceRef || ''),
            metadataJson: toJsonInputValue((participant as Record<string, unknown>).metadataJson),
          }))
        : [emptyParticipant()]
      : [],
  roleType: String(detail.roleType || ''),
  personName: String(detail.personName || ''),
  regulatedFlag: Boolean(detail.regulatedFlag),
  proposedEffectiveAt: toDateTimeLocalValue(detail.proposedEffectiveAt as string | null),
  effectiveAt: toDateTimeLocalValue(detail.effectiveAt as string | null),
  endedAt: toDateTimeLocalValue(detail.endedAt as string | null),
  assignee: String(detail.assignee || ''),
  trainingType: String(detail.trainingType || ''),
  dueAt: toDateTimeLocalValue(detail.dueAt as string | null),
  completedAt: toDateTimeLocalValue(detail.completedAt as string | null),
  waiverReason: String(detail.waiverReason || ''),
  disclosureType: String(detail.disclosureType || ''),
  disclosedByName: String(detail.disclosedByName || ''),
  disclosedAt: toDateTimeLocalValue(detail.disclosedAt as string | null),
  reviewDueAt: toDateTimeLocalValue(detail.reviewDueAt as string | null),
  mitigationSummary: String(detail.mitigationSummary || ''),
  closedAt: toDateTimeLocalValue(detail.closedAt as string | null),
  materialType: String(detail.materialType || ''),
  supersededAt: toDateTimeLocalValue(detail.supersededAt as string | null),
});

const parseJsonObject = (value: string, label: string) => {
  const normalized = value.trim();
  if (!normalized) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`${label} must be a valid JSON object.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
};

const optionalString = (value: string) => value.trim();

const setIfPresent = (target: Record<string, unknown>, key: string, value?: string) => {
  if (value && value.trim()) {
    target[key] = value.trim();
  }
};

const setDateIfPresent = (target: Record<string, unknown>, key: string, value?: string) => {
  const parsed = toIsoDateTime(value);
  if (parsed) target[key] = parsed;
};

const buildParticipantsPayload = (participants: ShareholdingParticipantFormState[]) =>
  participants.map((participant) => ({
    participantType: participant.participantType,
    participantName: participant.participantName.trim(),
    ...(participant.ownershipPercent.trim()
      ? { ownershipPercent: participant.ownershipPercent.trim() }
      : {}),
    ...(participant.controlSummary.trim()
      ? { controlSummary: participant.controlSummary.trim() }
      : {}),
    ...(participant.evidenceRef.trim() ? { evidenceRef: participant.evidenceRef.trim() } : {}),
    metadataJson: parseJsonObject(participant.metadataJson, 'Participant metadata JSON'),
  }));

export const validateRegistryFormState = (
  registryType: RegistryType,
  formState: GovernanceRegistryFormState,
): string | null => {
  switch (registryType) {
    case 'shareholding-versions':
      if (formState.participants.length < 1) {
        return 'At least one participant is required.';
      }
      if (formState.participants.some((participant) => !participant.participantName.trim())) {
        return 'Each participant must include a participant name.';
      }
      break;
    case 'appointments':
      if (!formState.roleType.trim()) return 'Role Type is required.';
      if (!formState.personName.trim()) return 'Person Name is required.';
      break;
    case 'trainings':
      if (!formState.assignee.trim()) return 'Assignee is required.';
      if (!formState.trainingType.trim()) return 'Training Type is required.';
      break;
    case 'conflicts':
      if (!formState.disclosureType.trim()) return 'Disclosure Type is required.';
      if (!formState.disclosedByName.trim()) return 'Disclosed By is required.';
      break;
    case 'wind-down-materials':
      if (!formState.materialType.trim()) return 'Material Type is required.';
      if (!formState.versionLabel.trim()) return 'Version Label is required.';
      break;
    default:
      break;
  }

  try {
    parseJsonObject(formState.metadataJson, 'Metadata JSON');
    if (registryType === 'shareholding-versions') {
      buildParticipantsPayload(formState.participants);
    }
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON payload.';
  }

  return null;
};

export const buildRegistryCreatePayload = (
  registryType: RegistryType,
  formState: GovernanceRegistryFormState,
) => {
  const payload: Record<string, unknown> = {
    metadataJson: parseJsonObject(formState.metadataJson, 'Metadata JSON'),
  };

  setIfPresent(payload, 'traceId', formState.traceId);
  setIfPresent(payload, 'evidenceRef', formState.evidenceRef);

  switch (registryType) {
    case 'shareholding-versions':
      payload.status = formState.status;
      payload.participants = buildParticipantsPayload(formState.participants);
      setIfPresent(payload, 'versionLabel', formState.versionLabel);
      setIfPresent(payload, 'supersedesId', formState.supersedesId);
      setDateIfPresent(payload, 'effectiveFrom', formState.effectiveFrom);
      return payload;
    case 'appointments':
      payload.roleType = formState.roleType.trim();
      payload.personName = formState.personName.trim();
      payload.regulatedFlag = formState.regulatedFlag;
      payload.status = formState.status;
      setDateIfPresent(payload, 'proposedEffectiveAt', formState.proposedEffectiveAt);
      setDateIfPresent(payload, 'effectiveAt', formState.effectiveAt);
      return payload;
    case 'trainings':
      payload.assignee = formState.assignee.trim();
      payload.trainingType = formState.trainingType.trim();
      payload.status = formState.status;
      setDateIfPresent(payload, 'dueAt', formState.dueAt);
      setDateIfPresent(payload, 'completedAt', formState.completedAt);
      setIfPresent(payload, 'waiverReason', formState.waiverReason);
      return payload;
    case 'conflicts':
      payload.disclosureType = formState.disclosureType.trim();
      payload.disclosedByName = formState.disclosedByName.trim();
      payload.status = formState.status;
      setDateIfPresent(payload, 'disclosedAt', formState.disclosedAt);
      setDateIfPresent(payload, 'reviewDueAt', formState.reviewDueAt);
      setIfPresent(payload, 'mitigationSummary', formState.mitigationSummary);
      return payload;
    case 'wind-down-materials':
      payload.materialType = formState.materialType.trim();
      payload.versionLabel = formState.versionLabel.trim();
      payload.status = formState.status;
      setDateIfPresent(payload, 'effectiveAt', formState.effectiveAt);
      setDateIfPresent(payload, 'reviewDueAt', formState.reviewDueAt);
      return payload;
    default:
      return payload;
  }
};

export const buildRegistryUpdatePayload = (
  registryType: RegistryType,
  formState: GovernanceRegistryFormState,
) => {
  const payload: Record<string, unknown> = {
    metadataJson: parseJsonObject(formState.metadataJson, 'Metadata JSON'),
    evidenceRef: optionalString(formState.evidenceRef),
    traceId: optionalString(formState.traceId),
  };

  switch (registryType) {
    case 'shareholding-versions':
      payload.versionLabel = optionalString(formState.versionLabel);
      payload.status = formState.status;
      payload.evidenceRef = optionalString(formState.evidenceRef);
      payload.traceId = optionalString(formState.traceId);
      payload.participants = buildParticipantsPayload(formState.participants);
      setDateIfPresent(payload, 'effectiveFrom', formState.effectiveFrom);
      setDateIfPresent(payload, 'effectiveTo', formState.effectiveTo);
      return payload;
    case 'appointments':
      payload.roleType = formState.roleType.trim();
      payload.personName = formState.personName.trim();
      payload.regulatedFlag = formState.regulatedFlag;
      payload.status = formState.status;
      setDateIfPresent(payload, 'proposedEffectiveAt', formState.proposedEffectiveAt);
      setDateIfPresent(payload, 'effectiveAt', formState.effectiveAt);
      setDateIfPresent(payload, 'endedAt', formState.endedAt);
      return payload;
    case 'trainings':
      payload.assignee = formState.assignee.trim();
      payload.trainingType = formState.trainingType.trim();
      payload.status = formState.status;
      payload.waiverReason = optionalString(formState.waiverReason);
      setDateIfPresent(payload, 'dueAt', formState.dueAt);
      setDateIfPresent(payload, 'completedAt', formState.completedAt);
      return payload;
    case 'conflicts':
      payload.disclosureType = formState.disclosureType.trim();
      payload.disclosedByName = formState.disclosedByName.trim();
      payload.status = formState.status;
      payload.mitigationSummary = optionalString(formState.mitigationSummary);
      setDateIfPresent(payload, 'disclosedAt', formState.disclosedAt);
      setDateIfPresent(payload, 'reviewDueAt', formState.reviewDueAt);
      setDateIfPresent(payload, 'closedAt', formState.closedAt);
      return payload;
    case 'wind-down-materials':
      payload.materialType = formState.materialType.trim();
      payload.versionLabel = formState.versionLabel.trim();
      payload.status = formState.status;
      setDateIfPresent(payload, 'effectiveAt', formState.effectiveAt);
      setDateIfPresent(payload, 'reviewDueAt', formState.reviewDueAt);
      setDateIfPresent(payload, 'supersededAt', formState.supersededAt);
      return payload;
    default:
      return payload;
  }
};

export const getRegistryFormHeader = (registryType: RegistryType, mode: 'create' | 'edit') => {
  const config = getRegistryConfig(registryType);
  return mode === 'create' ? config.createTitle : config.editTitle;
};

export const getRegistryFormDescription = (
  registryType: RegistryType,
  mode: 'create' | 'edit',
) => {
  const config = getRegistryConfig(registryType);
  return mode === 'create'
    ? `Create a new ${config.detailTitle.toLowerCase()} and keep the record aligned with the governance registry truth.`
    : `Update the existing ${config.detailTitle.toLowerCase()} without changing the linked governance history model.`;
};

export const getRegistryBackPath = (registryType: RegistryType, id?: string) =>
  id ? getRegistryDetailPath(registryType, id) : getRegistryListPath(registryType);

export const getRegistrySuccessPath = (registryType: RegistryType, id: string) =>
  getRegistryDetailPath(registryType, id);

export const getRegistryEditSuccessPath = (registryType: RegistryType, id: string) =>
  getRegistryDetailPath(registryType, id);

export const getRegistryCreateLink = (registryType: RegistryType) =>
  getRegistryCreatePath(registryType);

export const getRegistryEditLink = (registryType: RegistryType, id: string) =>
  getRegistryEditPath(registryType, id);
