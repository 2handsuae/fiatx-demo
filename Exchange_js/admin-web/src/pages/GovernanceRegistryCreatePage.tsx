import GovernanceRegistryFormPage from './GovernanceRegistryFormPage';
import type { RegistryType } from './governanceRegistryConfig';

const GovernanceRegistryCreatePage = ({ registryType }: { registryType: RegistryType }) => (
  <GovernanceRegistryFormPage registryType={registryType} mode="create" />
);

export default GovernanceRegistryCreatePage;
