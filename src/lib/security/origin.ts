/**
 * Origin validation helper for CSRF / Cross-Origin state-changing requests.
 * Phase C3 Security Hardening.
 */

export function validateOrigin(req: Request): { valid: boolean; reason?: string } {
  const method = req.method.toUpperCase();
  // Safe HTTP methods do not modify server state
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  const originHeader = req.headers.get('origin');
  const refererHeader = req.headers.get('referer');
  const hostHeader = req.headers.get('host');

  const secFetchSite = req.headers.get('sec-fetch-site');
  // Strict CSRF defense: cross-site state-changing requests are strictly forbidden
  if (secFetchSite === 'cross-site') {
    return { valid: false, reason: 'CROSS_SITE_REQUEST_FORBIDDEN' };
  }

  let requestOrigin: string | null = null;

  if (originHeader) {
    try {
      requestOrigin = new URL(originHeader).origin;
    } catch {
      return { valid: false, reason: 'INVALID_ORIGIN_HEADER' };
    }
  } else if (refererHeader) {
    try {
      requestOrigin = new URL(refererHeader).origin;
    } catch {
      return { valid: false, reason: 'INVALID_REFERER_HEADER' };
    }
  } else if (req.url) {
    try {
      requestOrigin = new URL(req.url).origin;
    } catch {
      requestOrigin = null;
    }
  }

  // State-changing requests must have an identifiable origin
  if (!requestOrigin) {
    return { valid: false, reason: 'MISSING_ORIGIN_AND_REFERER' };
  }

  const allowedOrigins = new Set<string>();

  // 1. Configured base URL
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    try {
      allowedOrigins.add(new URL(process.env.NEXT_PUBLIC_BASE_URL).origin);
    } catch {
      // Ignore invalid URL formatting in env
    }
  }

  // 2. Matching host header
  if (hostHeader) {
    allowedOrigins.add(`https://${hostHeader}`);
    allowedOrigins.add(`http://${hostHeader}`);
  }

  // 3. Local development origins
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://127.0.0.1:3000');
    allowedOrigins.add('http://localhost:3001');
    allowedOrigins.add('http://127.0.0.1:3001');
  }

  // Check exact match
  if (allowedOrigins.has(requestOrigin)) {
    return { valid: true };
  }

  // Also support dynamic port matching in local dev (e.g. localhost:any_port)
  if (process.env.NODE_ENV !== 'production') {
    try {
      const parsed = new URL(requestOrigin);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return { valid: true };
      }
    } catch {
      // ignore
    }
  }

  return { valid: false, reason: `ORIGIN_MISMATCH: ${requestOrigin}` };
}
