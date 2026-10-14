import type { LogValue } from './logs';

const PRIVATE_FIELDS = new Set([
  'password',
  'passwd',
  'passphrase',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'secret',
  'clientsecret',
  'authorization',
  'proxyauthorization',
  'apikey',
  'privatekey',
  'cookie',
  'setcookie',
  'credential',
  'credentials',
  'content',
  'filecontents',
  'clipboard',
  'terminalinput',
  'stdin',
  'commitmessage',
  'summary',
  'body',
]);
const EVIDENCE_FIELDS = [
  'operationId',
  'nativeOperationId',
  'method',
  'phase',
  'startedAt',
  'durationMs',
  'repository',
  'errorCode',
  'error',
  'code',
  'message',
  'diagnostic',
  'diagnosticId',
  'kind',
  'stage',
  'exitCode',
  'signal',
  'ioKind',
  'osCode',
  'stderr',
  'causes',
  'cause',
  'output',
  'command',
  'params',
  'stack',
];

/** Evidence is bounded explicitly, so support can tell when information was omitted. */
export function boundLogText(text: string, limit: number): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n[truncated: ${text.length - limit} characters omitted]`
    : text;
}

function redactPatterns(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z\d]{20,}|github_pat_[A-Za-z\d_]{20,})\b/g, '[redacted]')
    .replace(/\bAKIA[A-Z\d]{16}\b/g, '[redacted]')
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z\d+/_.=-]+/gi, '$1 [redacted]')
    .replace(
      /([?&](?:access_token|refresh_token|token|password|passphrase|secret|api_key|client_secret)=)[^&\s"']*/gi,
      '$1[redacted]',
    )
    .replace(
      /((?:password|passwd|passphrase|token|secret|authorization|api[_-]?key|cookie)["']?\s*[=:]\s*)(["'])(?:\\.|(?!\2)[\s\S])*?\2/gi,
      '$1"[redacted]"',
    )
    .replace(
      /((?:password|passwd|passphrase|token|secret|authorization|api[_-]?key|cookie)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi,
      '$1[redacted]',
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[redacted private key]',
    );
}

/** Redact common credentials, including escaped JSON inside a native error's cause. */
export function redactLogText(text: string): string {
  if (looksLikeJson(text)) {
    try {
      return JSON.stringify(redactLogValue(JSON.parse(text)), null, 2);
    } catch {
      // Diagnostic output is usually plain text, and malformed JSON still needs redaction.
    }
  }
  return redactPatterns(text);
}

function looksLikeJson(text: string): boolean {
  const first = text.trimStart()[0];
  return first === '{' || first === '[';
}

/** Remove input that an API may echo even when it does not resemble a credential. */
export function redactKnownLogValues(text: string, values: readonly string[]): string {
  return values.reduce((safe, value) => {
    if (!value) return safe;
    return safe
      .split(value)
      .join('[redacted]')
      .split(JSON.stringify(value).slice(1, -1))
      .join('[redacted]');
  }, text);
}

/** Safe JSON at the capture boundary, before notifying listeners or persisting a record. */
export function redactLogValue(
  value: unknown,
  sanitize: (text: string) => string = (text) => text,
): LogValue {
  const seen = new WeakSet<object>();
  const encoder = new TextEncoder();
  let remaining = 40000;
  let nodes = 0;
  const size = (item: LogValue) => encoder.encode(JSON.stringify(item)).length;
  const take = <T extends LogValue>(item: T): T => {
    remaining -= size(item);
    return item;
  };
  const marker = (reason: string): string => take(`[truncated: ${reason}]`);
  const cutString = (text: string): string => {
    const budget = remaining - 64;
    let low = 0;
    let high = Math.min(12000, text.length);
    if (size(boundLogText(text, high)) <= budget) return take(boundLogText(text, high));
    if (size(boundLogText(text, 0)) > budget) return marker('diagnostic size limit');
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (size(boundLogText(text, middle)) <= budget) low = middle;
      else high = middle - 1;
    }
    return take(boundLogText(text, low));
  };
  const appendObjectMarker = (result: Record<string, LogValue>, reason: string) => {
    const value = `[truncated: ${reason}]`;
    const cost = size('_truncated') + size(value) + 1 + (Object.keys(result).length ? 1 : 0);
    if (remaining < cost) return;
    remaining -= cost;
    Object.defineProperty(result, '_truncated', { value, enumerable: true, configurable: true });
  };
  const appendArrayMarker = (result: LogValue[], reason: string) => {
    const value = `[truncated: ${reason}]`;
    const cost = size(value) + (result.length ? 1 : 0);
    if (remaining < cost) return;
    remaining -= cost;
    result.push(value);
  };
  const visit = (item: unknown, depth: number): LogValue => {
    if (depth > 8) return marker('depth limit');
    if (remaining < 128) return marker('diagnostic size limit');
    if (++nodes > 1000) return marker('node limit');
    if (item === null || typeof item === 'boolean') return take(item);
    if (typeof item === 'number') return take(Number.isFinite(item) ? item : String(item));
    if (typeof item === 'string') {
      const safe = sanitize(item);
      const redacted = looksLikeJson(safe) ? redactLogText(safe) : redactPatterns(safe);
      return cutString(redacted);
    }
    if (item === undefined) return take(null);
    if (typeof item !== 'object') return take(`[${typeof item}]`);
    if (seen.has(item)) return take('[circular reference]');
    seen.add(item);
    if (Array.isArray(item)) {
      remaining -= 2; // JSON brackets.
      const result: LogValue[] = [];
      try {
        for (const entry of item.slice(0, 30)) {
          if (remaining < 128 || nodes >= 1000) {
            appendArrayMarker(result, nodes >= 1000 ? 'node limit' : 'diagnostic size limit');
            break;
          }
          if (result.length) remaining--;
          result.push(visit(entry, depth + 1));
        }
        if (item.length > 30) appendArrayMarker(result, `${item.length - 30} items omitted`);
      } catch {
        appendArrayMarker(result, 'unreadable array');
      } finally {
        seen.delete(item);
      }
      return result;
    }
    remaining -= 2; // JSON braces.
    const result: Record<string, LogValue> = {};
    try {
      const fields = Object.keys(item).sort((left, right) => {
        const rank = (key: string) => {
          const index = EVIDENCE_FIELDS.indexOf(key);
          return index < 0 ? EVIDENCE_FIELDS.length : index;
        };
        return rank(left) - rank(right);
      });
      for (const field of fields.slice(0, 60)) {
        const key = redactPatterns(field).slice(0, 128);
        let raw: unknown;
        try {
          raw = PRIVATE_FIELDS.has(field.replace(/[_\s-]/g, '').toLowerCase())
            ? '[redacted]'
            : (item as Record<string, unknown>)[field];
          if (raw === undefined) continue;
        } catch {
          raw = '[unreadable property]';
        }
        const cost = size(key) + 1 + (Object.keys(result).length ? 1 : 0);
        if (remaining < cost + 128 || nodes >= 1000) {
          appendObjectMarker(result, nodes >= 1000 ? 'node limit' : 'diagnostic size limit');
          break;
        }
        remaining -= cost;
        const entry = visit(raw, depth + 1);
        Object.defineProperty(result, key, { value: entry, enumerable: true, configurable: true });
      }
      if (fields.length > 60)
        appendObjectMarker(result, `${fields.length - 60} properties omitted`);
    } catch {
      return take('[unreadable object]');
    } finally {
      seen.delete(item);
    }
    return result;
  };
  return visit(value, 0);
}
