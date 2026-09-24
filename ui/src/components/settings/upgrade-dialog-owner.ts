// General renders both Machine and About sections. Only one may restore a
// running upgrade dialog after navigation; the initiating section owns it.
let owner: 'machines' | 'about' | null = null

export function claimUpgradeDialog(next: 'machines' | 'about') { owner = next }
export function shouldRestoreUpgradeDialog(candidate: 'machines' | 'about') {
  return (owner ?? 'machines') === candidate
}
