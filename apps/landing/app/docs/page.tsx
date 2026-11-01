import Link from "next/link"
import {
  ArrowRight,
  BookOpenText,
  ChartNoAxesCombined,
  GitBranch,
  Inbox,
  Plug,
  Search,
  Settings2,
  TerminalSquare,
  TimerReset,
} from "lucide-react"
import type { Metadata } from "next"
import { SOCIAL_IMAGE } from "@/app/lib/site"
import {
  DEV_DOCS_VERSION_LABEL,
  STABLE_DOCS_VERSION,
} from "@/lib/docs/release-channel"

const title = "OpenAlice Docs"
const description =
  "Guides and references for installing, running, extending, and auditing OpenAlice."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/docs" },
  openGraph: {
    title,
    description,
    url: "/docs",
    type: "website",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [SOCIAL_IMAGE.url],
  },
}

export default function DocsIndexPage() {
  const readingPath = [
    {
      title: "Understand the model",
      description:
        "Start with trading as collaboration: workspaces, issues, tracked context, Inbox, and optional broker execution.",
      href: "/docs/getting-started/what-is-openalice",
      icon: BookOpenText,
      meta: "01",
    },
    {
      title: "Run your first task",
      description:
        "Open Alice, ask for research, track what should persist, create an issue, and read the report in Inbox.",
      href: "/docs/getting-started/quick-start",
      icon: Inbox,
      meta: "02",
    },
    {
      title: "Install or deploy",
      description:
        "Choose the right path for macOS, Windows, the stable CLI, local development, or a private SSH Machine.",
      href: "/docs/getting-started/installation",
      icon: TerminalSquare,
      meta: "03",
    },
  ]

  const areas = [
    {
      title: "Core workspace surfaces",
      description:
        "The product spine: Workspaces, attributable Sessions, Issue Board, tracked context, and Inbox.",
      href: "/docs/workspaces/workspaces",
      icon: TimerReset,
      links: [
        ["Workspace Manager", "/docs/workspaces/manager"],
        ["Sessions & Collaboration", "/docs/workspaces/sessions-and-collaboration"],
        ["Issue Board", "/docs/workspaces/issues"],
        ["Entities & Tracking", "/docs/workspaces/entities"],
        ["Inbox", "/docs/workspaces/inbox"],
      ],
    },
    {
      title: "Analysis tools",
      description:
        "Read-only market data, symbol search, fundamentals, quant checks, sector rotation, and news.",
      href: "/docs/market-data/data-hub",
      icon: ChartNoAxesCombined,
      links: [
        ["Symbol Search", "/docs/market-data/symbol-search"],
        ["Equity Research", "/docs/market-data/equity-research"],
        ["Quant Calculator", "/docs/market-data/technical-analysis"],
      ],
    },
    {
      title: "Unified Trading Account",
      description:
        "Optional beta execution layer for paper, demo, testnet, and live accounts after you validate the path.",
      href: "/docs/core-concepts/unified-trading-account",
      icon: GitBranch,
      links: [
        ["Trading Setup", "/docs/trading/accounts-and-brokers"],
        ["Broker Packs", "/docs/trading/broker-packs"],
        ["Trading as Git", "/docs/core-concepts/trading-as-git"],
        ["Orders & Execution", "/docs/trading/orders-and-execution"],
      ],
    },
    {
      title: "Configuration and extension",
      description:
        "AI credentials, Discord/Telegram delivery, external MCP access, file-backed state, and extension points.",
      href: "/docs/integration/ai-providers",
      icon: Settings2,
      links: [
        ["AI Providers", "/docs/integration/ai-providers"],
        ["External Connectors", "/docs/integration/external-connectors"],
        ["MCP Server", "/docs/connectors/mcp-integration"],
        ["Custom Tools", "/docs/extending/custom-tools"],
      ],
    },
  ]

  const reference = [
    {
      title: "Data & Credentials",
      href: "/docs/deployment/data-and-credentials",
      icon: TerminalSquare,
    },
    {
      title: "Automation",
      href: "/docs/workspaces/automation",
      icon: TimerReset,
    },
    {
      title: "Lifecycle & Offboarding",
      href: "/docs/workspaces/lifecycle",
      icon: GitBranch,
    },
    {
      title: "CLI & Remote Access",
      href: "/docs/deployment/remote-access",
      icon: TerminalSquare,
    },
    {
      title: "Upgrades & Absorb",
      href: "/docs/workspaces/upgrades-and-absorb",
      icon: GitBranch,
    },
    {
      title: "Configuration Reference",
      href: "/docs/configuration/configuration-reference",
      icon: Settings2,
    },
    {
      title: "External MCP access",
      href: "/docs/connectors/mcp-integration",
      icon: Plug,
    },
  ]

  return (
    <article className="docs-home">
      <section className="docs-home-hero" data-section="docs_home_hero">
        <p className="docs-home-kicker">OpenAlice Docs</p>
        <h1>Start with collaboration. Add execution later.</h1>
        <p>
          OpenAlice turns trading into workspace-shaped work: agents research in
          repos, track entities, manage issues, and send reports to Inbox.
          Broker execution exists, but it is optional beta infrastructure behind
          UTA and Trading as Git.
        </p>
        <div className="docs-home-hero-actions">
          <Link
            href="/docs/getting-started/quick-start"
            data-evt="docs_home_hero_link"
            data-target="docs"
            data-location="docs_home"
          >
            <Inbox aria-hidden="true" />
            Quick Start
          </Link>
          <Link
            href="/docs/getting-started/what-is-openalice"
            data-evt="docs_home_hero_link"
            data-target="docs"
            data-location="docs_home"
          >
            <BookOpenText aria-hidden="true" />
            What is OpenAlice
          </Link>
        </div>
      </section>

      <section className="docs-home-channels" aria-label="Documentation release channels">
        <div className="docs-home-channel docs-home-channel-stable">
          <span>Stable</span>
          <strong>{STABLE_DOCS_VERSION}</strong>
          <p>Source-reviewed guides for the current stable release.</p>
        </div>
        <div className="docs-home-channel docs-home-channel-dev">
          <span>Dev preview</span>
          <strong>{DEV_DOCS_VERSION_LABEL}</strong>
          <p>Pages marked Dev describe unreleased behavior. Unmarked pages have not been version-checked.</p>
        </div>
      </section>

      <section
        className="docs-home-paths"
        data-section="docs_home_paths"
        aria-label="Recommended reading path"
      >
        {readingPath.map(({ title, description, href, icon: Icon, meta }) => (
          <Link
            key={href}
            href={href}
            data-evt="docs_home_path_link"
            data-target="docs"
            data-location="docs_home"
            className="docs-home-card"
          >
            <span className="docs-home-card-top">
              <span>{meta}</span>
              <Icon aria-hidden="true" />
            </span>
            <span className="docs-home-card-title">{title}</span>
            <span className="docs-home-card-description">{description}</span>
            <span className="docs-home-card-link">
              Read guide
              <ArrowRight aria-hidden="true" />
            </span>
          </Link>
        ))}
      </section>

      <section
        className="docs-home-section docs-home-section-stacked"
        data-section="docs_home_areas"
      >
        <div className="docs-home-section-heading">
          <p className="docs-home-kicker">Find docs by job</p>
          <h2>Pick the system surface you are trying to understand.</h2>
        </div>
        <div className="docs-home-area-grid">
          {areas.map(({ title, description, href, icon: Icon, links }) => (
            <div key={title} className="docs-home-area">
              <Link
                href={href}
                data-evt="docs_home_area_link"
                data-target="docs"
                data-location="docs_home"
                className="docs-home-area-main"
              >
                <span className="docs-home-card-top">
                  <Icon aria-hidden="true" />
                  <span>{title}</span>
                </span>
                <span className="docs-home-card-description">{description}</span>
                <span className="docs-home-card-link">
                  Open overview
                  <ArrowRight aria-hidden="true" />
                </span>
              </Link>
              <div className="docs-home-area-links">
                {links.map(([label, link]) => (
                  <Link
                    key={link}
                    href={link}
                    data-evt="docs_home_area_sublink"
                    data-target="docs"
                    data-location="docs_home"
                  >
                    <Search aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        className="docs-home-section docs-home-beta"
        data-section="docs_home_trading_safety"
      >
        <div>
          <p className="docs-home-kicker">Trading safety</p>
          <h2>UTA is useful, but still beta.</h2>
        </div>
        <div className="docs-home-beta-copy">
          <p>
            Start with simulator, paper, demo, or testnet accounts. Confirm
            account reads, staging, approval, push, sync, snapshots, and error
            recovery before using live funds.
          </p>
          <Link
            href="/docs/core-concepts/unified-trading-account"
            data-evt="docs_home_beta_link"
            data-target="docs"
            data-location="docs_home"
          >
            <GitBranch aria-hidden="true" />
            Read the UTA boundary
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="docs-home-section" data-section="docs_home_reference">
        <div>
          <p className="docs-home-kicker">Need a reference?</p>
          <h2>Jump to the operational pages people usually look for next.</h2>
        </div>
        <div className="docs-home-reference">
          {reference.map(({ title, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              data-evt="docs_home_reference_link"
              data-target="docs"
              data-location="docs_home"
              className="docs-home-reference-link"
            >
              <Icon aria-hidden="true" />
              <span>{title}</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </article>
  )
}
