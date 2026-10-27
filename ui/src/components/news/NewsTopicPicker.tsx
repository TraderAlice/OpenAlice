import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { inputClass } from '../form'
import { Button } from '../ui/button'

export function NewsTopicPicker({ topics, topic, onChange }: { topics: Array<{ topic: string; count: number }>; topic: string | null; onChange: (value: string | null) => void }) {
  const { t } = useTranslation()
  const [followed, setFollowed] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      try { const result = await api.news.followedTopics(controller.signal); if (!controller.signal.aborted) { setFollowed(result.topics); setError(false) } }
      catch { if (!controller.signal.aborted) setError(true) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [attempt])
  const following = topic !== null && followed.includes(topic.toLowerCase())
  const options = [...topics, ...followed.filter(value => !topics.some(item => item.topic.toLowerCase() === value)).map(topic => ({ topic, count: 0 }))]
  const changeFollow = async () => {
    if (!topic) return
    setSaving(true)
    try { setFollowed((await api.news.setTopicFollow(topic, !following)).topics); setError(false) }
    catch { setError(true) }
    finally { setSaving(false) }
  }
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <label className="flex min-w-0 items-center gap-2">{t('news.eventTopics')}
      <select className={`${inputClass} h-8 w-auto max-w-full text-xs`} value={topic ?? ''} onChange={event => onChange(event.target.value || null)}>
        <option value="">{t('news.allTopics')}</option>
        {options.map(item => <option key={item.topic} value={item.topic}>{item.topic} ({item.count})</option>)}
      </select>
    </label>
    {topic && <Button size="xs" variant="ghost" aria-pressed={following} disabled={loading || saving || error} onClick={() => void changeFollow()}><Bell className="size-3.5" fill={following ? 'currentColor' : 'none'} aria-hidden />{t(following ? 'news.unfollowTopic' : 'news.followTopic')}</Button>}
    {error && <span role="alert">{t('news.followingUnavailable')} <Button size="xs" variant="link" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</Button></span>}
  </div>
}
