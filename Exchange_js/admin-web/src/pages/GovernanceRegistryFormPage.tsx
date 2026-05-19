import { useEffect, useMemo, useState, type FormEvent, type HTMLInputTypeAttribute, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  createInitialRegistryFormState,
  emptyParticipant,
  type GovernanceRegistryFormState,
  type ShareholdingParticipantFormState,
  buildRegistryCreatePayload,
  buildRegistryUpdatePayload,
  getRegistryBackPath,
  getRegistryEditSuccessPath,
  getRegistryFormDescription,
  getRegistryFormHeader,
  getRegistrySuccessPath,
  hydrateRegistryFormState,
  SHAREHOLDING_PARTICIPANT_TYPE_OPTIONS,
  validateRegistryFormState,
} from './governanceRegistryFormConfig';
import { getRegistryConfig, type RegistryType } from './governanceRegistryConfig';

type GovernanceRegistryFormPageProps = {
  registryType: RegistryType;
  mode: 'create' | 'edit';
};

const SectionCard = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
    <div className="mb-5">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
    </div>
    <div className="space-y-5">{children}</div>
  </div>
);

const FieldLabel = ({
  label,
  required = false,
}: {
  label: string;
  required?: boolean;
}) => (
  <label className="block text-sm font-medium text-gray-700">
    {label}
    {required ? <span className="ml-1 text-red-500">*</span> : null}
  </label>
);

const TextInput = ({
  label,
  value,
  onChange,
  required = false,
  placeholder,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: HTMLInputTypeAttribute;
  disabled?: boolean;
}) => (
  <div className="space-y-2">
    <FieldLabel label={label} required={required} />
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
    />
  </div>
);

const TextAreaInput = ({
  label,
  value,
  onChange,
  required = false,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
  placeholder?: string;
}) => (
  <div className="space-y-2">
    <FieldLabel label={label} required={required} />
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
    />
  </div>
);

const SelectInput = ({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  required?: boolean;
}) => (
  <div className="space-y-2">
    <FieldLabel label={label} required={required} />
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </div>
);

const DateTimeInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => <TextInput label={label} type="datetime-local" value={value} onChange={onChange} />;

const CheckboxInput = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (nextValue: boolean) => void;
}) => (
  <label className="flex items-center gap-3 rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-sm text-gray-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary"
    />
    <span>{label}</span>
  </label>
);

const GovernanceRegistryFormPage = ({
  registryType,
  mode,
}: GovernanceRegistryFormPageProps) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const config = useMemo(() => getRegistryConfig(registryType), [registryType]);
  const [formState, setFormState] = useState<GovernanceRegistryFormState>(() =>
    createInitialRegistryFormState(registryType),
  );
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !id) {
      return;
    }

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/governance/registries/${config.endpoint}/${id}`,
        );
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, `Failed to load ${config.detailTitle}.`));
        }

        const result = (await response.json()) as Record<string, unknown>;
        setFormState(hydrateRegistryFormState(registryType, result));
      } catch (e: unknown) {
        if (e instanceof AdminSessionError) return;
        setError(e instanceof Error ? e.message : `Failed to load ${config.detailTitle}.`);
      } finally {
        setLoading(false);
      }
    };

    void fetchDetail();
  }, [config.detailTitle, config.endpoint, id, mode, registryType]);

  const updateField = <K extends keyof GovernanceRegistryFormState>(
    key: K,
    value: GovernanceRegistryFormState[K],
  ) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const updateParticipant = (
    index: number,
    key: keyof ShareholdingParticipantFormState,
    value: string,
  ) => {
    setFormState((prev) => ({
      ...prev,
      participants: prev.participants.map((participant, participantIndex) =>
        participantIndex === index ? { ...participant, [key]: value } : participant,
      ),
    }));
  };

  const addParticipant = () => {
    setFormState((prev) => ({
      ...prev,
      participants: [...prev.participants, emptyParticipant()],
    }));
  };

  const removeParticipant = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      participants:
        prev.participants.length > 1
          ? prev.participants.filter((_, participantIndex) => participantIndex !== index)
          : prev.participants,
    }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const validationError = validateRegistryFormState(registryType, formState);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const payload =
        mode === 'create'
          ? buildRegistryCreatePayload(registryType, formState)
          : buildRegistryUpdatePayload(registryType, formState);

      const endpoint =
        mode === 'create'
          ? `${import.meta.env.VITE_API_URL}/admin/governance/registries/${config.endpoint}`
          : `${import.meta.env.VITE_API_URL}/admin/governance/registries/${config.endpoint}/${id}`;

      const response = await adminFetch(endpoint, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(
            response,
            `Failed to ${mode === 'create' ? 'create' : 'update'} ${config.detailTitle.toLowerCase()}.`,
          ),
        );
      }

      const result = (await response.json()) as { id: string };
      navigate(
        mode === 'create'
          ? getRegistrySuccessPath(registryType, result.id)
          : getRegistryEditSuccessPath(registryType, result.id),
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error
          ? e.message
          : `Failed to ${mode === 'create' ? 'create' : 'update'} ${config.detailTitle.toLowerCase()}.`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderShareholdingFields = () => (
    <>
      <SectionCard
        title="Registry Details"
        description="Define the shareholding version and its high-level governance references."
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <TextInput
            label="Version Label"
            value={formState.versionLabel}
            onChange={(value) => updateField('versionLabel', value)}
          />
          <SelectInput
            label="Status"
            value={formState.status}
            onChange={(value) => updateField('status', value)}
            options={config.statusOptions}
          />
          <DateTimeInput
            label="Effective From"
            value={formState.effectiveFrom}
            onChange={(value) => updateField('effectiveFrom', value)}
          />
          {mode === 'edit' ? (
            <DateTimeInput
              label="Effective To"
              value={formState.effectiveTo}
              onChange={(value) => updateField('effectiveTo', value)}
            />
          ) : (
            <TextInput
              label="Supersedes Registry Id"
              value={formState.supersedesId}
              onChange={(value) => updateField('supersedesId', value)}
            />
          )}
          <TextInput
            label="Evidence Ref"
            value={formState.evidenceRef}
            onChange={(value) => updateField('evidenceRef', value)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Participants"
        description="Keep at least one participant so the version remains reviewable and demo-friendly."
      >
        <div className="space-y-4">
          {formState.participants.map((participant, index) => (
            <div key={`participant-${index}`} className="rounded-xl border border-admin-border bg-gray-50 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Participant {index + 1}</h3>
                <button
                  type="button"
                  onClick={() => removeParticipant(index)}
                  disabled={formState.participants.length === 1}
                  className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-3 py-1.5 text-xs text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SelectInput
                  label="Participant Type"
                  value={participant.participantType}
                  onChange={(value) => updateParticipant(index, 'participantType', value)}
                  options={[...SHAREHOLDING_PARTICIPANT_TYPE_OPTIONS]}
                  required
                />
                <TextInput
                  label="Participant Name"
                  value={participant.participantName}
                  onChange={(value) => updateParticipant(index, 'participantName', value)}
                  required
                />
                <TextInput
                  label="Ownership Percent"
                  value={participant.ownershipPercent}
                  onChange={(value) => updateParticipant(index, 'ownershipPercent', value)}
                  placeholder="e.g. 35.00"
                />
                <TextInput
                  label="Evidence Ref"
                  value={participant.evidenceRef}
                  onChange={(value) => updateParticipant(index, 'evidenceRef', value)}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <TextAreaInput
                  label="Control Summary"
                  value={participant.controlSummary}
                  onChange={(value) => updateParticipant(index, 'controlSummary', value)}
                  rows={3}
                />
                <TextAreaInput
                  label="Participant Metadata JSON"
                  value={participant.metadataJson}
                  onChange={(value) => updateParticipant(index, 'metadataJson', value)}
                  rows={4}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addParticipant}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
          >
            <Plus size={16} />
            Add Participant
          </button>
        </div>
      </SectionCard>
    </>
  );

  const renderAppointmentFields = () => (
    <SectionCard
      title="Appointment Details"
      description="Capture the core appointment facts that later gates can bind to."
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <TextInput
          label="Role Type"
          value={formState.roleType}
          onChange={(value) => updateField('roleType', value)}
          required
        />
        <TextInput
          label="Person Name"
          value={formState.personName}
          onChange={(value) => updateField('personName', value)}
          required
        />
        <SelectInput
          label="Status"
          value={formState.status}
          onChange={(value) => updateField('status', value)}
          options={config.statusOptions}
        />
        <div className="space-y-2">
          <FieldLabel label="Regulated Appointment" />
          <CheckboxInput
            label="This appointment requires regulatory gate control."
            checked={formState.regulatedFlag}
            onChange={(value) => updateField('regulatedFlag', value)}
          />
        </div>
        <DateTimeInput
          label="Proposed Effective At"
          value={formState.proposedEffectiveAt}
          onChange={(value) => updateField('proposedEffectiveAt', value)}
        />
        <DateTimeInput
          label="Effective At"
          value={formState.effectiveAt}
          onChange={(value) => updateField('effectiveAt', value)}
        />
        {mode === 'edit' ? (
          <DateTimeInput
            label="Ended At"
            value={formState.endedAt}
            onChange={(value) => updateField('endedAt', value)}
          />
        ) : null}
        <TextInput
          label="Evidence Ref"
          value={formState.evidenceRef}
          onChange={(value) => updateField('evidenceRef', value)}
        />
      </div>
    </SectionCard>
  );

  const renderTrainingFields = () => (
    <SectionCard
      title="Training Details"
      description="Capture assignment, due date, and completion evidence without adding extra workflow."
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <TextInput
          label="Assignee"
          value={formState.assignee}
          onChange={(value) => updateField('assignee', value)}
          required
        />
        <TextInput
          label="Training Type"
          value={formState.trainingType}
          onChange={(value) => updateField('trainingType', value)}
          required
        />
        <SelectInput
          label="Status"
          value={formState.status}
          onChange={(value) => updateField('status', value)}
          options={config.statusOptions}
        />
        <TextInput
          label="Evidence Ref"
          value={formState.evidenceRef}
          onChange={(value) => updateField('evidenceRef', value)}
        />
        <DateTimeInput
          label="Due At"
          value={formState.dueAt}
          onChange={(value) => updateField('dueAt', value)}
        />
        <DateTimeInput
          label="Completed At"
          value={formState.completedAt}
          onChange={(value) => updateField('completedAt', value)}
        />
      </div>
      <TextAreaInput
        label="Waiver Reason"
        value={formState.waiverReason}
        onChange={(value) => updateField('waiverReason', value)}
        rows={3}
      />
    </SectionCard>
  );

  const renderConflictFields = () => (
    <SectionCard
      title="Conflict Details"
      description="Capture the disclosure and review facts first; mitigation remains a simple free-text summary."
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <TextInput
          label="Disclosure Type"
          value={formState.disclosureType}
          onChange={(value) => updateField('disclosureType', value)}
          required
        />
        <TextInput
          label="Disclosed By"
          value={formState.disclosedByName}
          onChange={(value) => updateField('disclosedByName', value)}
          required
        />
        <SelectInput
          label="Status"
          value={formState.status}
          onChange={(value) => updateField('status', value)}
          options={config.statusOptions}
        />
        <TextInput
          label="Evidence Ref"
          value={formState.evidenceRef}
          onChange={(value) => updateField('evidenceRef', value)}
        />
        <DateTimeInput
          label="Disclosed At"
          value={formState.disclosedAt}
          onChange={(value) => updateField('disclosedAt', value)}
        />
        <DateTimeInput
          label="Review Due At"
          value={formState.reviewDueAt}
          onChange={(value) => updateField('reviewDueAt', value)}
        />
        {mode === 'edit' ? (
          <DateTimeInput
            label="Closed At"
            value={formState.closedAt}
            onChange={(value) => updateField('closedAt', value)}
          />
        ) : null}
      </div>
      <TextAreaInput
        label="Mitigation Summary"
        value={formState.mitigationSummary}
        onChange={(value) => updateField('mitigationSummary', value)}
        rows={4}
      />
    </SectionCard>
  );

  const renderWindDownFields = () => (
    <SectionCard
      title="Wind-down Material"
      description="Keep the material reference lightweight so the registry can serve future governance gates without over-modeling."
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <TextInput
          label="Material Type"
          value={formState.materialType}
          onChange={(value) => updateField('materialType', value)}
          required
        />
        <TextInput
          label="Version Label"
          value={formState.versionLabel}
          onChange={(value) => updateField('versionLabel', value)}
          required
        />
        <SelectInput
          label="Status"
          value={formState.status}
          onChange={(value) => updateField('status', value)}
          options={config.statusOptions}
        />
        <TextInput
          label="Evidence Ref"
          value={formState.evidenceRef}
          onChange={(value) => updateField('evidenceRef', value)}
        />
        <DateTimeInput
          label="Effective At"
          value={formState.effectiveAt}
          onChange={(value) => updateField('effectiveAt', value)}
        />
        <DateTimeInput
          label="Review Due At"
          value={formState.reviewDueAt}
          onChange={(value) => updateField('reviewDueAt', value)}
        />
        {mode === 'edit' ? (
          <DateTimeInput
            label="Superseded At"
            value={formState.supersededAt}
            onChange={(value) => updateField('supersededAt', value)}
          />
        ) : null}
      </div>
    </SectionCard>
  );

  const renderRegistryFields = () => {
    switch (registryType) {
      case 'shareholding-versions':
        return renderShareholdingFields();
      case 'appointments':
        return renderAppointmentFields();
      case 'trainings':
        return renderTrainingFields();
      case 'conflicts':
        return renderConflictFields();
      case 'wind-down-materials':
        return renderWindDownFields();
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading registry form...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(getRegistryBackPath(registryType, mode === 'edit' ? id : undefined))}
          className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getRegistryFormHeader(registryType, mode)}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {getRegistryFormDescription(registryType, mode)}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {renderRegistryFields()}

        <SectionCard
          title="Traceability"
          description="Keep metadata and trace identifiers explicit so the registry stays auditable."
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <TextAreaInput
              label="Metadata JSON"
              value={formState.metadataJson}
              onChange={(value) => updateField('metadataJson', value)}
              rows={8}
            />
            <TextInput
              label="Trace ID"
              value={formState.traceId}
              onChange={(value) => updateField('traceId', value)}
            />
          </div>
        </SectionCard>

        <div className="flex justify-end gap-3 border-t border-admin-border pt-4">
          <button
            type="button"
            onClick={() => navigate(getRegistryBackPath(registryType, mode === 'edit' ? id : undefined))}
            className="rounded-lg border border-admin-border bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-6 py-2 text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save size={16} />
            )}
            {mode === 'create' ? 'Create Record' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GovernanceRegistryFormPage;
