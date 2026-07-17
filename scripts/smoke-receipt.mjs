export function failedReceiptChecks(receipt) {
  return Object.entries(receipt?.checks ?? {})
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name)
}
