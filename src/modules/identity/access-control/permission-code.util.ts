export function normalizePermissionPath(path: string): string {
  const cleanPath = String(path || '')
    .split('?')[0]
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!cleanPath) {
    return 'root';
  }

  const parts = cleanPath
    .split('/')
    .map((part) =>
      part
        .replace(/^:/, '')
        .replace(/\*/g, 'wildcard')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean);

  return parts.length > 0 ? parts.join('_') : 'root';
}

export function buildPermissionCode(method: string, path: string): string {
  const normalizedMethod = String(method || 'GET').trim().toLowerCase();
  const normalizedPath = normalizePermissionPath(path);
  return `api.${normalizedMethod}.${normalizedPath}`;
}
