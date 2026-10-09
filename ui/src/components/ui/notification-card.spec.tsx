// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationCard } from './notification-card'
import { safeNotificationImage } from '../../lib/notifications/image'

afterEach(cleanup)

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('compact notification media/actions', () => {
  it('collapses failed media while retaining exact headline and action, then accepts a different image', () => {
    const action = vi.fn()
    const close = vi.fn()
    const content = { status: 'info' as const, title: 'Reuters', articleId: 1, description: 'Headline', image: '/demo/news/blueberries.jpg', action: { label: 'View News', onClick: action } }
    const view = render(<NotificationCard content={content} onClose={close} />)
    const image = view.container.querySelector('img')!
    expect(image.getAttribute('width')).toBe('64')
    expect(image.getAttribute('height')).toBe('48')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.error(image)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByText('Headline')).toBeTruthy()
    view.rerender(<NotificationCard content={{ ...content, image: '/demo/news/larch.jpg', articleId: 2, description: 'Latest' }} onClose={close} />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/demo/news/larch.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'View News' }))
    expect(action).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
  it('keeps old/missing images text-only and exposes a labeled internal dismiss', () => {
    const close = vi.fn()
    const view = render(<NotificationCard content={{ status: 'error', title: 'Request failed' }} onClose={close} />)
    expect(view.container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'activityToast.dismiss' }))
    expect(close).toHaveBeenCalledOnce()
  })
  it.each(['javascript:alert(1)', 'data:image/png;base64,x', '//example.com/x.jpg', '/\\example.com/x.jpg', 'https://name:secret@example.com/x.jpg'])('rejects unsafe media %s', url => {
    expect(safeNotificationImage(url)).toBeUndefined()
  })
  it.each(['/demo/news/blueberries.jpg', 'https://cdn.example.com/x.jpg', 'http://cdn.example.com/x.jpg'])('accepts supported media %s', url => {
    expect(safeNotificationImage(url)).toBe(url)
  })
})
