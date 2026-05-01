/**
 * Simple tag-value pair used for algo parameters and misc options.
 * Mirrors: ibapi/tag_value.py
 */

export class TagValue {
  tag: string
  value: string

  constructor(tag?: string, value?: string) {
    this.tag = String(tag ?? '')
    this.value = String(value ?? '')
  }

  toString(): string {
    // Wire format — do not change lightly!
    return `${this.tag}=${this.value};`
  }
}

export type TagValueList = TagValue[] | null
