const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeHost = (host: string): string => {
  const trimmed = String(host || '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const formatHost = (host: string): string => {
  return host.includes(':') ? `[${host}]` : host;
};

export const expandLoopbackOrigins = (origins: string[]): string[] => {
  const expanded = new Set<string>();

  for (const rawOrigin of origins) {
    const origin = String(rawOrigin || '').trim();
    if (!origin) continue;

    try {
      const parsed = new URL(origin);
      const normalizedHost = normalizeHost(parsed.hostname);
      const portSegment = parsed.port ? `:${parsed.port}` : '';

      expanded.add(parsed.origin);

      if (!LOOPBACK_HOSTS.has(normalizedHost)) {
        continue;
      }

      for (const loopbackHost of LOOPBACK_HOSTS) {
        expanded.add(`${parsed.protocol}//${formatHost(loopbackHost)}${portSegment}`);
      }
    } catch {
      expanded.add(origin);
    }
  }

  return Array.from(expanded);
};

