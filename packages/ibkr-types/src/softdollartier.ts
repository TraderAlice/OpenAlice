/**
 * Soft dollar tier definition.
 * Mirrors: ibapi/softdollartier.py
 */

export class SoftDollarTier {
  name: string
  val: string
  displayName: string

  constructor(name = '', val = '', displayName = '') {
    this.name = name
    this.val = val
    this.displayName = displayName
  }

  toString(): string {
    return `Name: ${this.name}, Value: ${this.val}, DisplayName: ${this.displayName}`
  }
}
