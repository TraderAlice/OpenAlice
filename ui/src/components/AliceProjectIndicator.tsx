import { FolderKanban, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useAliceProject } from '@/hooks/useAliceProject'

export function AliceProjectIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { project, loading, error, refresh } = useAliceProject()
  const label = project?.displayName
    ?? (loading ? t('nav.aliceProject.loading') : t('nav.aliceProject.unavailable'))

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? 'icon-sm' : 'sm'}
            aria-label={t('nav.aliceProject.openDetails', { name: label })}
            title={t('nav.aliceProject.openDetails', { name: label })}
            className={compact
              ? 'relative text-muted-foreground'
              : 'h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left'}
          />
        }
      >
        <span className="relative shrink-0">
          <FolderKanban size={15} aria-hidden />
          <span
            className={`absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-muted ${error ? 'bg-destructive' : loading ? 'bg-muted-foreground/40' : 'bg-success'}`}
            aria-hidden
          />
        </span>
        {!compact && (
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('nav.aliceProject.label')}
            </span>
            <span className="block truncate text-xs font-medium text-foreground">{label}</span>
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FolderKanban size={18} aria-hidden />
            {t('nav.aliceProject.detailsTitle')}
          </DialogTitle>
          <DialogDescription>{t('nav.aliceProject.detailsDescription')}</DialogDescription>
        </DialogHeader>

        {project ? (
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{project.displayName}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{project.key}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-1 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                {t('nav.aliceProject.statusRunning')}
              </span>
            </div>
            <dl className="divide-y divide-border text-sm">
              <ProjectField label={t('nav.aliceProject.dataHome')} value={project.home} />
              <ProjectField label={t('nav.aliceProject.appRoot')} value={project.appRoot ?? t('nav.aliceProject.runtimeManaged')} />
              <ProjectField label={t('nav.aliceProject.stableId')} value={project.id} />
            </dl>
            <div className="flex gap-2 border-t border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <Server size={14} className="mt-0.5 shrink-0" aria-hidden />
              {t('nav.aliceProject.browserNote')}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">{label}</p>
            {!loading && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>
                <RefreshCw aria-hidden />
                {t('nav.aliceProject.retry')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProjectField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs leading-relaxed text-foreground">{value}</dd>
    </div>
  )
}
