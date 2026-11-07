import { ShieldCheck } from "lucide-react";

const log = [
  {
    sha: "a1f9c0d",
    type: "stage",
    color: "text-foreground/70",
    msg: "buy AAPL · 200 sh · stop @ 187.50",
    note: "pre-commit ✓ risk · drawdown 0.4% within bounds",
  },
  {
    sha: "7d4e2bb",
    type: "commit",
    color: "text-foreground/70",
    msg: "exit XLE on RSI<30 within 24h",
    note: "review ✓ awaiting human approval",
  },
  {
    sha: "9b2c4a1",
    type: "push",
    color: "text-emerald-700 dark:text-[#A4C59B]",
    msg: "order routed → IBKR",
    note: "approved by you · 2s",
  },
];

export function GitLogCard() {
  return (
    <div className="oa-git-card md:col-span-2 relative overflow-hidden">
      {/* Header strip */}
      <div className="relative z-[2] flex items-center justify-between px-5 py-3 border-b border-dashed border-border/60">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D88A8A]/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#E2C79F]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#A4C59B]/80" />
          </div>
          <span className="font-mono text-[11px] tracking-wider text-muted-foreground/80">
            ~/portfolios/main · alice
          </span>
        </div>
        <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-foreground/55">
          Trading as Git
        </span>
      </div>

      {/* Log body */}
      <div className="relative z-[2] px-5 py-5 font-mono text-[12.5px] leading-[1.85] tnum">
        <div className="text-muted-foreground/70 mb-2">
          $ alice trade <span className="text-foreground/80">--commit</span>
        </div>
        {log.map((row, i) => (
          <div key={row.sha} className="flex items-start gap-3">
            {/* graph column */}
            <div className="flex flex-col items-center pt-[2px] shrink-0 w-3">
              <span className={`text-base leading-none ${row.color}`}>●</span>
              {i < log.length - 1 && (
                <span className="text-border/80 leading-none mt-0.5">│</span>
              )}
            </div>
            {/* content */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[#A78B6B] dark:text-[#E9D7B7]">{row.sha}</span>
                <span className={`uppercase tracking-wider text-[10.5px] ${row.color}`}>
                  {row.type}
                </span>
                <span className="text-foreground/85">{row.msg}</span>
              </div>
              <div className="text-muted-foreground/70 text-[11.5px] pl-0.5">
                ↳ {row.note}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Animated rail at the bottom */}
      <div className="relative z-[2] px-5 pb-5 pt-3 border-t border-dashed border-border/60">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
          <span>stage</span>
          <span>commit</span>
          <span className="flex items-center gap-1 text-emerald-700 dark:text-[#A4C59B]">
            <ShieldCheck className="w-3 h-3" /> push
          </span>
        </div>
        <div className="relative h-[2px] bg-border/70 rounded-full">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#A78B6B]/60 to-[#A4C59B]/70 rounded-full" />
          <span className="absolute -top-[5px] left-0 commit-dot">
            <span className="block w-3 h-3 rounded-full bg-foreground shadow-[0_0_0_3px_var(--background)]" />
          </span>
          <span className="absolute -top-[3px] left-0 w-2 h-2 rounded-full bg-foreground/70" />
          <span className="absolute -top-[3px] left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground/70" />
          <span className="absolute -top-[3px] right-0 w-2 h-2 rounded-full bg-emerald-700 dark:bg-[#A4C59B]" />
        </div>
      </div>
    </div>
  );
}
