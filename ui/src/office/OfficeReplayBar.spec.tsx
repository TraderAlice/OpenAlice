// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeReplayBar } from './OfficeReplayBar'

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('OfficeReplayBar', () => {
  it('scrubs seq and returns to live', async () => {
    const onAsOfSeq = vi.fn()
    render(<OfficeReplayBar lastSeq={6} asOfSeq={2} onAsOfSeq={onAsOfSeq} />)
    expect(screen.getByText('Seq 2')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Live' }))
    expect(onAsOfSeq).toHaveBeenCalledWith(null)
  })

  it('hides when the journal is empty', () => {
    render(<OfficeReplayBar lastSeq={0} asOfSeq={null} onAsOfSeq={vi.fn()} />)
    expect(screen.queryByLabelText('Replay')).toBeNull()
  })
})
