import { useEffect, useState } from 'react'
import { useDiscoverySnapshot } from '../lib/updates/useDiscoverySnapshot'
import { head } from '../components/dev/upgrade-rehearsal/releases'
import {
  initial,
  reduce,
  scenarios,
  type Action,
} from '../components/dev/upgrade-rehearsal/model'
const KEY = 'openalice.dev.upgrade-rehearsal.v3'
// Persist commands rather than trusting a serialized runtime state. Replaying
// through the reducer preserves guards and the approved plan after a reload.
function valid(a: unknown): a is Action {
  if (!a || typeof a !== 'object' || !('type' in a)) return false
  if (a.type === 'scenario')
    return (
      'value' in a &&
      typeof a.value === 'string' &&
      Object.hasOwn(scenarios, a.value)
    )
  if (a.type === 'advance')
    return 'value' in a && typeof a.value === 'string' && a.value.length < 200
  if (a.type === 'publish' || a.type === 'channel')
    return 'value' in a && ['stable', 'beta', 'dev'].includes(String(a.value))
  if (a.type === 'backend' || a.type === 'content')
    return 'value' in a && typeof a.value === 'boolean'
  return [
    'continue',
    'discover',
    'review',
    'back',
    'approve',
    'next',
    'resume',
    'retry',
    'release',
    'reset',
  ].includes(String(a.type))
}
export function useUpgradeRehearsal() {
  const [actions, setActions] = useState<Action[]>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
      return Array.isArray(saved) && saved.length <= 2000 && saved.every(valid)
        ? saved
        : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(actions))
    } catch {
      /* Rehearsal remains usable without storage. */
    }
  }, [actions])
  const [state, setState] = useState(initial)
  useEffect(() => {
    let active = true
    void (async () => {
      let next = initial()
      for (const action of actions) next = await reduce(next, action)
      if (active) setState(next)
    })()
    return () => { active = false }
  }, [actions])
  const discovery = useDiscoverySnapshot<ReturnType<typeof head>>(
    `${state.channel}:${state.publication.heads[state.channel] ?? 'empty'}:${state.client}`,
  )
  useEffect(() => {
    void discovery.check(async () => head(state.publication, state.channel))
  }, [state.publication, state.channel, state.client, discovery.check])
  function dispatch(a: Action) {
    setActions((old) =>
      a.type === 'reset'
        ? [{ type: 'scenario', value: state.scenario }]
        : [...old, a],
    )
  }
  const checkForUpdates = async () => {
    const result = await discovery.check(async () =>
      head(state.publication, state.channel),
    )
    if (result) dispatch({ type: 'discover' })
  }
  return { state, dispatch, discovery, checkForUpdates }
}
