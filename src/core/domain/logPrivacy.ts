/** Redact common credentials before they enter either the live viewer or disk. */
export function redactLogText(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z\d]{20,}|github_pat_[A-Za-z\d_]{20,})\b/g, '[redacted]')
    .replace(/\bAKIA[A-Z\d]{16}\b/g, '[redacted]')
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z\d+/_.=-]+/gi, '$1 [redacted]')
    .replace(/([?&](?:access_token|token|password|secret|api_key)=)[^&\s"']*/gi, '$1[redacted]')
    .replace(
      /((?:password|passwd|token|secret|authorization|api[_-]?key)["']?\s*[=:]\s*)(["'])(.*?)\2/gi,
      '$1"[redacted]"',
    )
    .replace(
      /((?:password|passwd|token|secret|authorization|api[_-]?key)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi,
      '$1[redacted]',
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[redacted private key]',
    );
}
