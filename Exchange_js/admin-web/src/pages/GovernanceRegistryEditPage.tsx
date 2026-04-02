import GovernanceRegistryFormPage from './GovernanceRegistryFormPage';
import type { RegistryType } from './governanceRegistryConfig';

const GovernanceRegistryEditPage = ({ registryType }: { registryType: RegistryType }) => (
  <GovernanceRegistryFormPage registryType={registryType} mode="edit" />
);

export default GovernanceRegistryEditPage;
