/**
 * Ineligibility reason for order preview.
 * Mirrors: ibapi/ineligibility_reason.py
 */

export class IneligibilityReason {
  id: string
  description: string

  constructor(id?: string, description?: string) {
    this.id = String(id ?? '')
    this.description = String(description ?? '')
  }

  toString(): string {
    return `[id: ${this.id}, description: ${this.description}];`
  }
}
