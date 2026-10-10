export interface TerminalHttpLink {
  href: string;
  domain: string;
  start: number;
  length: number;
}

const HTTP_URL = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?\]}]+$/u;

function trimUnbalancedClosingParentheses(value: string): string {
  let result = value;
  while (result.endsWith(')')) {
    const opening = [...result].filter((character) => character === '(').length;
    const closing = [...result].filter((character) => character === ')').length;
    if (closing <= opening) break;
    result = result.slice(0, -1);
  }
  return result;
}

/** Extrae solo HTTP(S) plano; credenciales y protocolos ejecutables nunca se vuelven enlaces. */
export function findTerminalHttpLinks(line: string): TerminalHttpLink[] {
  return [...line.matchAll(HTTP_URL)].flatMap((match) => {
    const raw = match[0];
    const candidate = trimUnbalancedClosingParentheses(raw.replace(TRAILING_PUNCTUATION, ''));
    if (candidate.length === 0 || match.index === undefined) return [];
    const previous = line.at(match.index - 1);
    if (previous && /[a-z0-9+.-]/iu.test(previous)) return [];

    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      return [
        {
          href: url.href,
          domain: url.host,
          start: match.index,
          length: candidate.length,
        },
      ];
    } catch {
      return [];
    }
  });
}
