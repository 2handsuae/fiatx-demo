export const BUSINESS_CONFIG_RELEASES_PATH =
  '/dashboard/control-gates/business-config-releases';

export function buildBusinessConfigReadOnlyMessage(subjectLabel: string): string {
  return `${subjectLabel} is read-only in Phase 2. Manage changes through repo manifests, change tickets, approvals, and Business Config Releases.`;
}

export function showBusinessConfigReadOnlyAlert(subjectLabel: string): void {
  window.alert(buildBusinessConfigReadOnlyMessage(subjectLabel));
}
