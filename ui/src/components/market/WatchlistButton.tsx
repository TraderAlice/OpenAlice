import { Star } from 'lucide-react'
import { useWatchlist } from '../../tabs/watchlist-store'
import type { AssetClass } from '../../api/market'
import { Button } from '../ui/button'

/** Asset-local action, shared by all chart detail surfaces. */
export function WatchlistButton({ assetClass, symbol }: { assetClass: AssetClass; symbol: string }) {
  const pinned = useWatchlist(s => s.entries.some(e => e.assetClass === assetClass && e.symbol === symbol))
  const add = useWatchlist(s => s.add)
  const remove = useWatchlist(s => s.remove)
  const label = pinned ? 'Remove from watchlist' : 'Add to watchlist'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={pinned ? 'shrink-0 text-warning' : 'shrink-0 text-muted-foreground'}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      onClick={() => pinned ? remove(assetClass, symbol) : add(assetClass, symbol)}
    >
      <Star aria-hidden="true" className="size-4" strokeWidth={1.5} fill={pinned ? 'currentColor' : 'none'} />
    </Button>
  )
}
