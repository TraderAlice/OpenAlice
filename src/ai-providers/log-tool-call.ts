export function logToolCall(name: string, input: unknown) {
  const preview = JSON.stringify(input).slice(0, 120)
  console.log(`  ↳ ${name}(${preview})`)
}
