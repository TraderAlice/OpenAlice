// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { i18n } from '../i18n'
import { ActivityPreferencesSection } from './ActivityPreferencesSection'
import { DEFAULT_ACTIVITY_PREFERENCES as defaults, type ActivityPreferences } from '../../../apps/desktop/src/activity-policy'
beforeAll(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); Reflect.deleteProperty(window,'openAlice') })
function bridge(fail=false) {
  let settings=structuredClone(defaults)
  const updatePreferences=vi.fn(async(patch:Partial<ActivityPreferences>)=>{if(fail) throw new Error('disk failure');return settings={...settings,...patch}})
  const resetPreferences=vi.fn(async()=>settings=structuredClone(defaults))
  Object.defineProperty(window,'openAlice',{configurable:true,value:{companion:{activity:{getPreferences:async()=>settings,updatePreferences,resetPreferences,onPreferences:()=>()=>{}}}}})
  return {updatePreferences,resetPreferences}
}
describe('activity settings',()=>{
  it('shows desktop boundary',()=>{render(<ActivityPreferencesSection/>);expect(screen.queryByRole('combobox')).toBeNull();expect(screen.getByText(/desktop app/)).toBeTruthy()})
  it('shows explicit initial switches, autosaves edits, pause and reset',async()=>{
    const b=bridge();render(<ActivityPreferencesSection/>);const news=await screen.findByRole('switch',{name:'News'})
    expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByText('Use preset')).toBeNull()
    for(const name of ['Completion / Inbox','Failure','Action needed','News']) expect(screen.getByRole('switch',{name}).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch',{name:'Routine progress'}).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(news);await waitFor(()=>expect(b.updatePreferences).toHaveBeenCalledWith({events:{...defaults.events,news:false}}))
    await waitFor(()=>expect(news.getAttribute('aria-checked')).toBe('false'))
    fireEvent.click(screen.getByRole('button',{name:'Pause for 1 hour'}));await screen.findByRole('button',{name:'Resume notifications'})
    fireEvent.click(screen.getByRole('button',{name:'Restore notification defaults'}));await waitFor(()=>expect(b.resetPreferences).toHaveBeenCalled())
    await waitFor(()=>expect(news.getAttribute('aria-checked')).toBe('true'))
  })
  it('keeps confirmed settings after a save failure and exposes retry',async()=>{
    const b=bridge(true);render(<ActivityPreferencesSection/>);const news=await screen.findByRole('switch',{name:'News'})
    fireEvent.click(news);await screen.findByRole('alert');expect(news.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(news);await waitFor(()=>expect(b.updatePreferences).toHaveBeenCalledTimes(2))
  })
})
