import { useEffect, useState } from 'react'
import {
  BookOpen,
  Plus,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Tag,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Trash2,
  Sliders,
  Code2
} from 'lucide-react'
import {
  leanApi,
  type TradeJournalEntry,
  type CreateJournalEntryOptions,
  type FormalizedStrategyProposal
} from '../api/lean'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { QuantLabSidebar } from '../components/lean/QuantLabSidebar'

interface TradeJournalPageProps {
  spec?: Extract<ViewSpec, { kind: 'quant-lab-journal' }>
}

export function TradeJournalPage({ spec }: TradeJournalPageProps) {
  const { openOrFocus } = useWorkspace()
  const [entries, setEntries] = useState<TradeJournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [proposal, setProposal] = useState<FormalizedStrategyProposal | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [symbol, setSymbol] = useState('EURUSD')
  const [direction, setDirection] = useState<'long' | 'short'>('long')
  const [entryTime, setEntryTime] = useState(new Date().toISOString().slice(0, 16))
  const [entryPrice, setEntryPrice] = useState('1.08500')
  const [exitPrice, setExitPrice] = useState('1.08900')
  const [profitLoss, setProfitLoss] = useState('400')
  const [hypothesis, setHypothesis] = useState('')
  const [session, setSession] = useState('London')
  const [whatWorked, setWhatWorked] = useState('')
  const [whatFailed, setWhatFailed] = useState('')
  const [tagsInput, setTagsInput] = useState('breakout, london')

  const loadJournal = async () => {
    try {
      setLoading(true)
      const res = await leanApi.listJournal()
      if (res?.entries) {
        setEntries(res.entries)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadJournal()
  }, [])

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !hypothesis) {
      alert('Title and Hypothesis are required.')
      return
    }

    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const payload: CreateJournalEntryOptions = {
        title,
        symbol,
        direction,
        entryTime: new Date(entryTime).toISOString(),
        entryPrice: parseFloat(entryPrice) || 0,
        exitPrice: exitPrice ? parseFloat(exitPrice) : undefined,
        profitLoss: profitLoss ? parseFloat(profitLoss) : undefined,
        hypothesis,
        marketContext: {
          session,
          notes: ''
        },
        review: {
          whatWorked,
          whatFailed
        },
        tags
      }

      await leanApi.createJournal(payload)
      setCreating(false)
      setTitle('')
      setHypothesis('')
      loadJournal()
    } catch (err: any) {
      alert(`Failed to save journal entry: ${err.message}`)
    }
  }

  const handleFormalize = async (id: string) => {
    try {
      const res = await leanApi.formalizeJournal(id)
      if (res?.proposal) {
        setProposal(res.proposal)
        loadJournal()
      }
    } catch (err: any) {
      alert(`Formalization failed: ${err.message}`)
    }
  }

  const handleCreateStrategyFromProposal = async () => {
    if (!proposal) return
    try {
      const strat = await leanApi.createStrategy({
        name: proposal.strategyName,
        templateId: proposal.suggestedTemplateId,
        description: proposal.formalizedHypothesis,
        parameters: proposal.suggestedParameters
      })
      if (strat?.strategy?.id) {
        openOrFocus({
          kind: 'quant-lab-strategy',
          params: { id: strat.strategy.id }
        })
      }
    } catch (err: any) {
      alert(`Failed to instantiate algorithmic strategy: ${err.message}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this journal entry?')) return
    try {
      await leanApi.deleteJournal(id)
      loadJournal()
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  return (
    <PageSidebarLayout
      storageKey="quant-lab-sidebar"
      title="Quant Lab"
      defaultWidth={260}
      sidebar={<QuantLabSidebar />}
    >
      <div className="flex h-full flex-col overflow-y-auto bg-background p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="text-amber-500 h-6 w-6" />
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Discretionary Trade Journal & Systematic Formalizer
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Record manual trade ideas, hypotheses, and execution reviews — formalize them into testable LEAN algorithmic strategies.
            </p>
          </div>

          <button
            onClick={() => setCreating(!creating)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            New Trade Journal Entry
          </button>
        </div>

        {/* Create Entry Drawer/Form */}
        {creating && (
          <form
            onSubmit={handleCreateEntry}
            className="rounded-lg border border-border bg-card p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <span className="font-bold text-foreground">Record Discretionary Trade</span>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="font-semibold text-foreground">Trade Title</label>
                <input
                  type="text"
                  placeholder="e.g. Asian Range High Breakout on EURUSD"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-foreground">Forex Symbol</label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="EURUSD">EURUSD</option>
                  <option value="GBPUSD">GBPUSD</option>
                  <option value="USDJPY">USDJPY</option>
                  <option value="AUDUSD">AUDUSD</option>
                  <option value="USDCHF">USDCHF</option>
                  <option value="USDCAD">USDCAD</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="font-semibold text-foreground">Direction</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as any)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="long">Long (Buy)</option>
                  <option value="short">Short (Sell)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-foreground">Entry Price</label>
                <input
                  type="number"
                  step="0.00001"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-foreground">Exit Price</label>
                <input
                  type="number"
                  step="0.00001"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground">P&L ($)</label>
                <input
                  type="number"
                  value={profitLoss}
                  onChange={(e) => setProfitLoss(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-foreground">Trade Hypothesis & Rationale</label>
              <textarea
                placeholder="Describe setup conditions, triggers, session context, and indicators observed..."
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                rows={3}
                className="w-full mt-1 rounded-md border border-input bg-secondary/50 p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-foreground">What Worked</label>
                <input
                  type="text"
                  placeholder="Clean momentum through Asian high..."
                  value={whatWorked}
                  onChange={(e) => setWhatWorked(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground">Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="breakout, london, trend"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                Save Entry
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-4 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Formalization Proposal Modal / Banner */}
        {proposal && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="text-amber-500" size={16} />
                <h3 className="text-sm font-bold text-foreground">
                  Systematic Strategy Formulation Proposal
                </h3>
              </div>
              <button
                onClick={() => setProposal(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕ Close
              </button>
            </div>

            <div className="p-3 rounded bg-background border border-border text-xs space-y-2">
              <div>
                <span className="font-bold text-foreground">Suggested Template:</span>{' '}
                <span className="font-mono text-primary font-semibold">
                  {proposal.suggestedTemplateId}
                </span>
              </div>
              <div>
                <span className="font-bold text-foreground">Strategy Name:</span>{' '}
                <span>{proposal.strategyName}</span>
              </div>
              <div>
                <span className="font-bold text-foreground">Formalized Hypothesis:</span>{' '}
                <span className="text-muted-foreground">{proposal.formalizedHypothesis}</span>
              </div>
              <div>
                <span className="font-bold text-foreground">Suggested Parameters:</span>{' '}
                <pre className="mt-1 p-2 rounded bg-secondary/60 font-mono text-[11px]">
                  {JSON.stringify(proposal.suggestedParameters, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCreateStrategyFromProposal}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-bold shadow hover:bg-primary/90 transition-colors"
              >
                <Code2 size={14} />
                Instantiate LEAN Algorithm & Open Strategy Editor
              </button>
            </div>
          </div>
        )}

        {/* Entries List */}
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <RefreshCw className="animate-spin mr-2 inline" size={16} />
            Loading journal records...
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-xs text-muted-foreground">
            No trade journal entries recorded yet. Record your trade ideas and hypotheses above.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {entries.map((ent) => {
              const isWin = (ent.profitLoss || 0) >= 0
              return (
                <div
                  key={ent.id}
                  className="rounded-lg border border-border bg-card p-5 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-foreground">{ent.symbol}</span>
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            ent.direction === 'long'
                              ? 'bg-success/15 text-success'
                              : 'bg-destructive/15 text-destructive'
                          }`}
                        >
                          {ent.direction}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(ent.entryTime).toLocaleDateString()}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                          ent.formalizationStatus === 'formalized'
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {ent.formalizationStatus}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-foreground mt-2">{ent.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ent.hypothesis}</p>

                    <div className="flex items-center gap-4 mt-3 text-xs font-mono">
                      <span className="text-muted-foreground">
                        Entry: <span className="text-foreground">${ent.entryPrice.toFixed(5)}</span>
                      </span>
                      {ent.exitPrice && (
                        <span className="text-muted-foreground">
                          Exit: <span className="text-foreground">${ent.exitPrice.toFixed(5)}</span>
                        </span>
                      )}
                      {ent.profitLoss != null && (
                        <span className={`font-bold ${isWin ? 'text-success' : 'text-destructive'}`}>
                          {isWin ? '+' : ''}${ent.profitLoss.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {ent.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {ent.tags.map((tg) => (
                          <span
                            key={tg}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono"
                          >
                            #{tg}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                    <button
                      onClick={() => handleDelete(ent.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      title="Delete Entry"
                    >
                      <Trash2 size={13} />
                    </button>

                    <button
                      onClick={() => handleFormalize(ent.id)}
                      className="flex items-center gap-1.5 text-primary font-semibold hover:underline"
                    >
                      <Sparkles size={13} className="text-amber-500" />
                      Formalize into Strategy →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PageSidebarLayout>
  )
}
