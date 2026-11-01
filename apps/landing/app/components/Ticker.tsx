import { getQuotes } from "@/app/lib/quotes";

export async function Ticker() {
  const quotes = await getQuotes();
  if (quotes.length === 0) return null;

  return (
    <div className="relative border-b border-border/40 bg-background/60 overflow-hidden">
      <div className="flex no-scrollbar overflow-hidden whitespace-nowrap">
        <div className="ticker flex shrink-0">
          {[...quotes, ...quotes].map((t, i) => (
            <span
              key={i}
              className="font-mono text-[11px] tnum text-muted-foreground/80 px-5 py-2 flex items-center gap-2 shrink-0"
            >
              <span className="text-foreground/80">{t.sym}</span>
              <span>{t.px}</span>
              <span
                className={
                  t.isDown
                    ? "text-[#D88A8A]"
                    : "text-emerald-700 dark:text-[#A4C59B]"
                }
              >
                {t.chg}
              </span>
              <span className="text-border ml-2">·</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
