import net from 'net';

let warnedMissingCidrs = false;

/**
 * Checks if an IPv4 address is inside an IPv4 CIDR block.
 */
function isIpv4InCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bitsStr] = cidr.split('/');
    const maskBits = bitsStr ? parseInt(bitsStr, 10) : 32;
    if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;

    const ipParts = ip.split('.').map((p) => parseInt(p, 10));
    const rangeParts = range.split('.').map((p) => parseInt(p, 10));
    if (ipParts.length !== 4 || rangeParts.length !== 4) return false;

    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];

    if (maskBits === 0) return true;
    const mask = (~0 << (32 - maskBits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

/**
 * Checks if a peer address matches any CIDR or IP in the trusted list.
 */
export function isPeerTrusted(peerIp: string, trustedCidrs: string[]): boolean {
  if (!peerIp || trustedCidrs.length === 0) return false;
  const cleanPeer = peerIp.replace(/^::ffff:/, ''); // normalize IPv4-mapped IPv6

  for (const cidr of trustedCidrs) {
    const trimmed = cidr.trim();
    if (!trimmed) continue;
    if (trimmed === cleanPeer) return true;
    if (trimmed.includes('/') && isIpv4InCidr(cleanPeer, trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the client IP securely per Amendment A3:
 * - Checks socket peer against TRUSTED_PROXY_CIDRS.
 * - If trusted and header is present, resolves client IP (walking XFF right-to-left).
 * - Otherwise ignores headers and returns the direct peer IP.
 */
export function resolveClientIp(req: Request, socketPeerAddress?: string): string {
  const peer = socketPeerAddress || '127.0.0.1';
  const trustedHeaderName = (process.env.TRUSTED_IP_HEADER || '').trim().toLowerCase();
  const rawCidrs = (process.env.TRUSTED_PROXY_CIDRS || '').trim();
  const trustedCidrs = rawCidrs ? rawCidrs.split(',').map((c) => c.trim()).filter(Boolean) : [];

  // Warning when header is configured but CIDRs is empty in production
  if (trustedHeaderName && trustedCidrs.length === 0) {
    if (process.env.NODE_ENV === 'production' && !warnedMissingCidrs) {
      console.warn(
        '[SECURITY_WARNING] TRUSTED_IP_HEADER is configured but TRUSTED_PROXY_CIDRS is empty. ' +
        'Header will be ignored to prevent IP spoofing.'
      );
      warnedMissingCidrs = true;
    }
    return peer;
  }

  // If no trusted header or peer is not in trusted CIDRs, strictly return socket peer
  if (!trustedHeaderName || !isPeerTrusted(peer, trustedCidrs)) {
    return peer;
  }

  // Read header
  const headerValue = req.headers.get(trustedHeaderName);
  if (!headerValue) {
    return peer;
  }

  // If header is X-Forwarded-For, walk from right to left, skipping trusted proxies
  if (trustedHeaderName === 'x-forwarded-for') {
    const hops = headerValue.split(',').map((h) => h.trim().replace(/^::ffff:/, '')).filter(Boolean);
    // Walk from the right: the first hop that is NOT a trusted proxy is the real client IP
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i];
      if (!isPeerTrusted(hop, trustedCidrs)) {
        return hop;
      }
    }
    return peer;
  }

  // For single-IP headers (e.g. Arvan-Client-IP), return value if valid IP
  const singleIp = headerValue.trim().split(',')[0].trim().replace(/^::ffff:/, '');
  if (net.isIP(singleIp)) {
    return singleIp;
  }

  return peer;
}
