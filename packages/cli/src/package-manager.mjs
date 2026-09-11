const MANAGERS = Object.freeze({
  npm: {
    label: 'npm',
    update: 'npm install -g openalice@latest',
    uninstall: 'npm uninstall -g openalice',
  },
  bun: {
    label: 'Bun',
    update: 'bun add -g --trust openalice@latest',
    uninstall: 'bun remove -g openalice',
  },
  brew: {
    label: 'Homebrew',
    update: 'brew upgrade traderalice/tap/openalice',
    uninstall: 'brew uninstall traderalice/tap/openalice',
  },
  aur: {
    label: 'pacman/AUR',
    update: 'paru -S openalice-bin',
    uninstall: 'paru -Rns openalice-bin',
  },
})

export function packageManager(method) {
  return MANAGERS[method] ?? null
}

export function packageManagerForSource(source) {
  return source?.schemaVersion === 3 ? packageManager(source.method) : null
}

export function packageManagerUpdateMessage(source) {
  const manager = packageManagerForSource(source)
  if (!manager) return null
  return `${manager.label} owns this OpenAlice installation.\nStop a running Runtime first with: openalice down\nUpdate with: ${manager.update}`
}

export function packageManagerUninstallMessage(source) {
  const manager = packageManagerForSource(source)
  if (!manager) return null
  return `${manager.label} owns this OpenAlice installation.\nStop a running Runtime first with: openalice down\nUninstall with: ${manager.uninstall}`
}
