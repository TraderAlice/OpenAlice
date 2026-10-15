const manufacturerAliases: Readonly<Record<string, string>> = {
  'z-ai': 'glm', zhipu: 'glm', 'x-ai': 'xai', moonshotai: 'kimi', moonshot: 'kimi',
  gemini: 'google', tencent: 'hunyuan', xiaomi: 'mimo', 'meta-llama': 'meta',
  mistralai: 'mistral', alibaba: 'qwen',
}

const modelFamilies: readonly [RegExp, string][] = [
  [/^(gpt[-\s]|o[134](?:-|$)|chatgpt|codex)/i, 'openai'],
  [/^claude[-\s]/i, 'anthropic'], [/^gemini[-\s]/i, 'google'],
  [/^grok[-\s]/i, 'xai'], [/^minimax[-\s]/i, 'minimax'],
  [/^glm[-\s]/i, 'glm'], [/^kimi[-\s]/i, 'kimi'],
  [/^deepseek[-\s]/i, 'deepseek'], [/^longcat[-\s]/i, 'longcat'],
  [/^(hy[0-9]|hunyuan)/i, 'hunyuan'], [/^mimo[-\s]/i, 'mimo'],
  [/^qwen/i, 'qwen'], [/^llama/i, 'meta'], [/^(mistral|ministral|codestral)/i, 'mistral'],
]

const wordNames: Readonly<Record<string, string>> = {
  gpt: 'GPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', minimax: 'MiniMax',
  glm: 'GLM', kimi: 'Kimi', deepseek: 'DeepSeek', longcat: 'LongCat', mimo: 'MiMo',
}

export function modelManufacturer(model: string, vendor?: string | null): string | undefined {
  const qualified = model.split('/')
  const name = qualified.at(-1) ?? model
  const family = modelFamilies.find(([pattern]) => pattern.test(name))?.[1]
  const provider = qualified.length > 1 ? qualified[0] : vendor
  return family ?? (provider ? manufacturerAliases[provider.toLowerCase()] ?? provider.toLowerCase() : undefined)
}

export function modelDisplayName(model: string, label?: string | null): string {
  if (label && label !== model) {
    return label.replace(/\s+\((?:highest capability|power|balanced|cost-efficient|flagship|fast \/ economical|previous gen(?:eration)?|complex agents|fastest|latest|recommended)\)$/i, '')
  }
  const name = model.split('/').at(-1) ?? model
  if (!modelFamilies.some(([pattern]) => pattern.test(name))) return model
  return name.replace(/(?<=\d)-(?=\d(?:-|$))/g, '.')
    .split('-').map((word) => wordNames[word.toLowerCase()] ?? (/^[a-z]/i.test(word) ? word[0]!.toUpperCase() + word.slice(1) : word)).join(' ')
}
