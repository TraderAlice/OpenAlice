import Image from "next/image";
import Link from "next/link";
import { mediaImage } from "@/lib/media";

const colTitle =
  "font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground/80 mb-4";
const colLink =
  "block text-[14px] text-foreground/75 hover:text-foreground ink-link w-fit mb-2";

export function Footer() {
  return (
    <footer id="site-footer" className="relative border-t border-border/50 bg-background mt-12">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-10">
            {/* Brand block */}
            <div className="col-span-2 md:col-span-5">
              <Link href="/" className="flex items-baseline gap-3 mb-4">
                <Image
                  {...mediaImage("/alice.png")}
                  alt=""
                  sizes="36px"
                  className="h-9 w-auto -translate-y-0.5"
                />
                <span className="display text-3xl">OpenAlice</span>
              </Link>
              <p className="text-foreground/70 text-[15px] leading-relaxed max-w-sm mb-6">
                A trading desk that fits in a folder. Free as in freedom, AGPL-3.0,
                self-hosted forever.
              </p>
              <div className="flex gap-2">
                {[
                  {
                    href: "https://github.com/TraderAlice/OpenAlice",
                    label: "GitHub",
                    target: "github_repo",
                    path: "M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z",
                  },
                  {
                    href: "https://x.com/OpenAliceAI",
                    label: "X",
                    target: "x_profile",
                    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
                  },
                  {
                    href: "https://discord.gg/MQvZgBFxw2",
                    label: "Discord",
                    target: "discord",
                    path: "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z",
                  },
                ].map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener"
                    aria-label={s.label}
                    data-evt={`footer_social_${s.label.toLowerCase()}`}
                    data-target={s.target}
                    data-location="footer"
                    className="w-9 h-9 rounded-full border border-border/70 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d={s.path} />
                    </svg>
                  </a>
                ))}
              </div>
            </div>

            <div className="col-span-1 md:col-span-2 md:col-start-8">
              <h4 className={colTitle}>Product</h4>
              <Link
                href="/download"
                data-evt="footer_install"
                data-target="download"
                data-location="footer"
                className={colLink}
              >
                Install
              </Link>
              <a
                href="https://github.com/TraderAlice/OpenAlice"
                target="_blank"
                rel="noopener"
                data-evt="footer_openalice"
                data-target="github_repo"
                data-location="footer"
                className={colLink}
              >
                Source code
              </a>
              <Link
                href="/docs"
                data-evt="footer_docs"
                data-target="docs"
                data-location="footer"
                className={colLink}
              >
                Docs
              </Link>
            </div>

            <div className="col-span-1 md:col-span-2">
              <h4 className={colTitle}>Resources</h4>
              <a
                href="https://demo.openalice.ai"
                target="_blank"
                rel="noopener"
                data-evt="footer_demo"
                data-target="demo"
                data-location="footer"
                className={colLink}
              >
                Live demo
              </a>
              <Link
                href="/blog"
                data-evt="footer_journal"
                data-target="blog"
                data-location="footer"
                className={colLink}
              >
                Journal
              </Link>
              <a
                href="https://discord.gg/MQvZgBFxw2"
                target="_blank"
                rel="noopener"
                data-evt="footer_discord"
                data-target="discord"
                data-location="footer"
                className={colLink}
              >
                Discord
              </a>
            </div>
          </div>

          <div className="mt-14 pt-6 border-t border-dashed border-border/60 flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="font-mono text-[11px] tracking-wider text-muted-foreground tnum">
              © {new Date().getFullYear()} OpenAlice · made with care, not capital
            </p>
            <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground/70">
              one person · one repo · one agent
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
