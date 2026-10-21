export interface ChatSource {
  id: string;
  title: string;
  url: string;
  domain: string;
}

function parseSource(value: unknown): ChatSource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string'
    || !/^source-[1-9]\d{0,2}$/.test(candidate.id)
    || typeof candidate.title !== 'string'
    || !candidate.title.trim()
    || candidate.title.length > 180
    || typeof candidate.url !== 'string'
    || candidate.url.length > 2048
    || typeof candidate.domain !== 'string'
    || !candidate.domain
    || candidate.domain.length > 253
  ) return undefined;

  const match = /^https?:\/\/([^/?#\s]+)(?:[/?#]|$)/i.exec(candidate.url);
  if (!match || match[1].includes('@')) return undefined;
  const authority = match[1].toLowerCase();
  const host = authority.replace(/:\d+$/, '').replace(/\.$/, '');
  const domain = candidate.domain.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host !== domain || /[\s<>]/.test(domain)) return undefined;

  return {
    id: candidate.id,
    title: candidate.title.trim(),
    url: candidate.url,
    domain,
  };
}

/** Drop malformed/unsafe metadata and retain only fields allowed in the mobile contract. */
export function parseChatSources(value: unknown): ChatSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources: ChatSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const source = parseSource(item);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    sources.push(source);
    if (sources.length === 10) break;
  }
  return sources.length ? sources : undefined;
}
