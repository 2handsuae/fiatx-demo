import { PERMISSIONS } from '../rbac/permissions';

export type RegistryType =
  | 'shareholding-versions'
  | 'appointments'
  | 'trainings'
  | 'conflicts'
  | 'wind-down-materials';

export interface RegistryConfig {
  type: RegistryType;
  endpoint: string;
  listTitle: string;
  detailTitle: string;
  description: string;
  noResultsText: string;
  numberField: string;
  numberLabel: string;
  statusOptions: string[];
  createPermission: string;
  updatePermission: string;
  detailPermission: string;
  createTitle: string;
  editTitle: string;
  gateType?: 'CONTROL_CHANGE' | 'REGULATED_APPOINTMENT_CHANGE';
}

export const REGISTRY_CONFIGS: Record<RegistryType, RegistryConfig> = {
  'shareholding-versions': {
    type: 'shareholding-versions',
    endpoint: 'shareholding-versions',
    listTitle: 'Governance Center - Shareholding Registry',
    detailTitle: 'Shareholding Registry Detail',
    description: 'Review corporate shareholding and UBO registry versions that support control-change governance.',
    noResultsText: 'No shareholding registry versions found',
    numberField: 'registryNo',
    numberLabel: 'Registry No',
    statusOptions: ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED'],
    createPermission: PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_CREATE,
    updatePermission: PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_UPDATE,
    detailPermission: PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_DETAIL_READ,
    createTitle: 'Create Shareholding Registry Version',
    editTitle: 'Edit Shareholding Registry Version',
    gateType: 'CONTROL_CHANGE',
  },
  appointments: {
    type: 'appointments',
    endpoint: 'appointments',
    listTitle: 'Governance Center - Appointments',
    detailTitle: 'Appointment Record Detail',
    description: 'Review appointment records for directors, regulated roles, and other governance appointments.',
    noResultsText: 'No appointment records found',
    numberField: 'appointmentNo',
    numberLabel: 'Appointment No',
    statusOptions: ['PLANNED', 'ACTIVE', 'ENDED', 'CANCELLED'],
    createPermission: PERMISSIONS.GOV_APPOINTMENT_CREATE,
    updatePermission: PERMISSIONS.GOV_APPOINTMENT_UPDATE,
    detailPermission: PERMISSIONS.GOV_APPOINTMENT_DETAIL_READ,
    createTitle: 'Create Appointment Record',
    editTitle: 'Edit Appointment Record',
    gateType: 'REGULATED_APPOINTMENT_CHANGE',
  },
  trainings: {
    type: 'trainings',
    endpoint: 'trainings',
    listTitle: 'Governance Center - Trainings',
    detailTitle: 'Training Record Detail',
    description: 'Track governance-related training assignments, completion evidence, and overdue items.',
    noResultsText: 'No training records found',
    numberField: 'trainingNo',
    numberLabel: 'Training No',
    statusOptions: ['ASSIGNED', 'COMPLETED', 'OVERDUE', 'WAIVED'],
    createPermission: PERMISSIONS.GOV_TRAINING_CREATE,
    updatePermission: PERMISSIONS.GOV_TRAINING_UPDATE,
    detailPermission: PERMISSIONS.GOV_TRAINING_DETAIL_READ,
    createTitle: 'Create Training Record',
    editTitle: 'Edit Training Record',
  },
  conflicts: {
    type: 'conflicts',
    endpoint: 'conflicts',
    listTitle: 'Governance Center - Conflicts',
    detailTitle: 'Conflict Disclosure Detail',
    description: 'Track conflict disclosures, review due dates, mitigation notes, and closeout status.',
    noResultsText: 'No conflict disclosures found',
    numberField: 'disclosureNo',
    numberLabel: 'Disclosure No',
    statusOptions: ['OPEN', 'UNDER_REVIEW', 'MITIGATED', 'CLOSED'],
    createPermission: PERMISSIONS.GOV_CONFLICT_CREATE,
    updatePermission: PERMISSIONS.GOV_CONFLICT_UPDATE,
    detailPermission: PERMISSIONS.GOV_CONFLICT_DETAIL_READ,
    createTitle: 'Create Conflict Disclosure',
    editTitle: 'Edit Conflict Disclosure',
  },
  'wind-down-materials': {
    type: 'wind-down-materials',
    endpoint: 'wind-down-materials',
    listTitle: 'Governance Center - Wind-down Materials',
    detailTitle: 'Wind-down Material Detail',
    description: 'Review wind-down material versions, review cycles, and superseded material references.',
    noResultsText: 'No wind-down material records found',
    numberField: 'materialNo',
    numberLabel: 'Material No',
    statusOptions: ['ACTIVE', 'SUPERSEDED', 'ARCHIVED'],
    createPermission: PERMISSIONS.GOV_WIND_DOWN_MATERIAL_CREATE,
    updatePermission: PERMISSIONS.GOV_WIND_DOWN_MATERIAL_UPDATE,
    detailPermission: PERMISSIONS.GOV_WIND_DOWN_MATERIAL_DETAIL_READ,
    createTitle: 'Create Wind-down Material',
    editTitle: 'Edit Wind-down Material',
  },
};

export const getRegistryConfig = (type: RegistryType): RegistryConfig => REGISTRY_CONFIGS[type];

export const getRegistryListPath = (type: RegistryType) =>
  `/admin/registries/${REGISTRY_CONFIGS[type].endpoint}`;

export const getRegistryDetailPath = (type: RegistryType, id: string) =>
  `${getRegistryListPath(type)}/${id}`;

export const getRegistryCreatePath = (type: RegistryType) =>
  `${getRegistryListPath(type)}/create`;

export const getRegistryEditPath = (type: RegistryType, id: string) =>
  `${getRegistryListPath(type)}/edit/${id}`;
