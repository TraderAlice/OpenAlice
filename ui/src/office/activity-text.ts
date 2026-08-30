export function officeActivityExcerpt(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return undefined
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized
}
