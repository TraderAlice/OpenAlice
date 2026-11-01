import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { ProductShowcase } from "./components/ProductShowcase";
import { DurableWorkflow } from "./components/DurableWorkflow";
import { SpecialistDesks } from "./components/SpecialistDesks";
import { ExecutionDemos } from "./components/ExecutionDemos";
import { OpenSourceProof } from "./components/OpenSourceProof";
import { getAllPosts } from "@/app/lib/posts";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_URL, SOCIAL_IMAGE } from "@/app/lib/site";
import { mediaUrl } from "@/lib/media";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    siteName: "OpenAlice",
    type: "website",
    locale: "en_US",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    creator: "@OpenAliceAI",
    images: [SOCIAL_IMAGE.url],
  },
};

// JSON-LD structured data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OpenAlice",
  description:
    "OpenAlice turns trading into a coding task so the coding agent you already use (Claude Code, Codex, opencode, Pi) can research, execute, and manage risk — open-source, self-hosted, every broker in one account.",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const FAQS = [
  {
    question: "What is OpenAlice?",
    answer:
      "OpenAlice is a self-hosted trading workspace for coding agents. It gives an agent a place to research, keep files and memory, run scheduled work, and optionally prepare broker actions through one reviewable workflow.",
    href: "/docs/getting-started/what-is-openalice",
    linkLabel: "See the product overview",
  },
  {
    question: "Which coding agents can I use?",
    answer:
      "Bring the agent CLI and subscription you already use. OpenAlice supports Claude Code, Codex, OpenCode, Pi, and other compatible agent CLIs without forcing you into a bundled model plan.",
    href: "/docs/workspaces/structure",
    linkLabel: "How agent sessions work",
  },
  {
    question: "Will an agent place trades without asking me?",
    answer:
      "Not by default. Alice can stage and commit an intent, but broker execution waits for your approval in the Web UI. Direct AI push is an explicit Pro setting; start with the simulator, paper, demo, or testnet path first.",
    href: "/docs/core-concepts/trading-as-git",
    linkLabel: "Read about the approval wall",
  },
  {
    question: "Do I need a broker account to get started?",
    answer:
      "No. Research, watchlists, issues, workspace automation, Inbox, and the built-in mock simulator work without trading credentials. Connect a broker only when you are ready to validate execution.",
    href: "/docs/getting-started/quick-start",
    linkLabel: "Start with the quick start",
  },
  {
    question: "Which brokers and markets are supported?",
    answer:
      "Optional Broker Packs cover paths including Alpaca, CCXT exchanges, IBKR, Longbridge, and LeverUp. Venue, instrument, and order-type support varies, so validate your specific route with paper or demo funds before going live.",
    href: "/docs/trading/accounts-and-brokers",
    linkLabel: "Check broker details",
  },
  {
    question: "Where do my data and credentials live?",
    answer:
      "OpenAlice runs on your machine and keeps its product state locally. Broker credentials are sealed at rest with a machine-bound key; the setup wizard is the normal way to add or change them.",
    href: "/docs/deployment/data-and-credentials",
    linkLabel: "Review data and credentials",
  },
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

export default async function Home() {
  const posts = getAllPosts();
  const latestPosts = posts.slice(0, 3);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="oa-home dark min-h-screen bg-background relative">
        <Nav landing />

        <main id="main-content" tabIndex={-1}>
        {/* Hero */}
        <section className="oa-hero" data-section="hero">
          <div className="relative z-[2] mx-auto max-w-[90rem] px-[clamp(1rem,2.5vw,2rem)] pb-16 pt-20 md:pb-20 md:pt-28">
            <div className="oa-hero-copy-block mx-auto text-center">
              <h1 className="oa-hero-title">
                Your coding agent can trade now.
              </h1>
              <p className="oa-hero-copy">
                Run Claude Code, Codex, OpenCode, Pi, and more against one self-hosted trading desk. Agents research, schedule, and stage operations; you decide what reaches the broker.
              </p>
              <div className="oa-hero-actions">
                <Link href="/download" data-evt="hero_install" data-target="download" data-location="hero" className="oa-action oa-action-primary">
                  Download OpenAlice
                </Link>
                <a href="https://github.com/TraderAlice/OpenAlice" target="_blank" rel="noopener" data-evt="hero_github" data-target="github_repo" data-location="hero" className="oa-action oa-action-secondary">
                  View on GitHub
                </a>
              </div>
            </div>

            <ProductShowcase />
          </div>
        </section>

        {/* Product proof — from a live agent session to a recurring desk */}
        <section id="agent-workflow" data-section="agent_workflow" className="oa-section oa-section-command relative py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="max-w-6xl mx-auto">
              <div className="oa-section-heading">
                <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-3">
                  The operating model
                </p>
                <h2 className="display text-5xl md:text-6xl leading-[0.95]">
                  Give the agent a system,<br />
                  <span className="text-foreground/60">not another chatbox.</span>
                </h2>
                <p className="text-foreground/70 text-[15px] leading-relaxed">
                  One Codex Session turns a brief into a named Issue. The same
                  object keeps its schedule and run history, then publishes a
                  source-bound report to Inbox.
                </p>
              </div>

              <DurableWorkflow />

            </div>
          </div>
        </section>

        {/* Specialist agent-native research environments */}
        <section id="specialist-desks" data-section="specialist_desks" className="oa-section oa-section-specialists relative py-20 md:py-24">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-6xl">
              <div className="oa-specialist-heading">
                <div>
                  <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-3">
                    Specialist research
                  </p>
                  <h2 className="display">
                    Go deeper.<br />
                    <span>Keep the same workflow.</span>
                  </h2>
                </div>
                <p>
                  Give the same agent focused environments for experiments,
                  evidence, and the next research decision.
                </p>
              </div>
              <SpecialistDesks />
            </div>
          </div>
        </section>

        {/* Reviewable trading substrate */}
        <section id="capabilities" data-section="capabilities" className="oa-section oa-section-capabilities relative py-20 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-6xl mx-auto">
              <div className="oa-section-heading flex items-end justify-between gap-6 flex-wrap">
                <div>
                  <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-3">
                    Reviewable execution
                  </p>
                  <h2 className="display text-5xl md:text-6xl max-w-2xl leading-[0.95]">
                    See the trade<br />
                    <span className="text-foreground/60">before it moves.</span>
                  </h2>
                </div>
                <p className="text-foreground/70 max-w-sm text-[15px] leading-relaxed">
                  Inspect the account, side, quantity, order type, and operation
                  diff before anything reaches a broker.
                </p>
              </div>

              <ExecutionDemos />
            </div>
          </div>
        </section>

        {/* Manifesto / pull-quote */}
        <section id="manifesto" data-section="manifesto" className="oa-manifesto relative overflow-hidden pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center relative">
              <p className="relative display text-3xl md:text-5xl leading-[1.15] text-foreground/90">
                Built in the open.<br />
                <span className="text-foreground/60">Kept on your machine.</span>
              </p>
              <div className="mt-7 font-mono text-[10.5px] tracking-[0.18em] uppercase text-muted-foreground">
                AGPL-3.0 · Local-first · Bring your own agent
              </div>
              <OpenSourceProof />
            </div>
          </div>
        </section>

        {/* Blog / Journal */}
        {latestPosts.length > 0 && (
          <section id="journal" data-section="journal" className="oa-section oa-section-journal relative pt-16 pb-20 md:pt-20 md:pb-24">
            <div className="container mx-auto px-4">
              <div className="max-w-6xl mx-auto">
                <div className="oa-journal-heading mb-12">
                  <div>
                    <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-3">
                      From the journal
                    </p>
                    <h2 className="display text-5xl md:text-6xl">
                      Field notes.
                    </h2>
                  </div>
                  <div className="oa-journal-index">
                    <p>
                      <strong>{String(latestPosts.length).padStart(2, "0")}</strong>
                      <span>Latest entries</span>
                    </p>
                    <Link
                      href="/blog"
                      data-evt="journal_read_all"
                      data-target="blog"
                      data-location="section"
                    >
                      Open archive →
                    </Link>
                  </div>
                </div>

                <div
                  className="oa-journal-grid grid md:grid-cols-3 gap-8"
                  role="region"
                  aria-label="Latest journal posts"
                >
                  {latestPosts.map((post, i) => (
                    <Link
                      key={post.slug}
                      href={`/blog/${post.slug}`}
                      data-evt={`journal_post_${post.slug}`}
                      data-target="blog"
                      data-location="section"
                      className="oa-journal-card group block"
                    >
                      <div className="oa-journal-cover relative aspect-[4/3] mb-5 overflow-hidden">
                        <Image
                          src={mediaUrl(`/blog/${post.slug}/cover.png`)}
                          alt={post.title}
                          fill
                          className="object-cover group-hover:scale-[1.04] transition-transform duration-500"
                          sizes="(max-width: 768px) 100vw, 33vw"
                        />
                        <span className="absolute top-3 left-3 font-mono text-[9.5px] tracking-[0.22em] uppercase bg-background/85 backdrop-blur px-2 py-1 rounded-sm">
                          № {String(i + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <h3 className="display text-2xl leading-tight mb-2 group-hover:text-foreground transition-colors text-foreground/85">
                        {post.title}
                      </h3>
                      <p className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground tnum">
                        {new Date(post.date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* FAQ — answer the questions that block installation */}
        <section id="faq" data-section="faq" className="oa-section oa-section-faq relative py-16 md:py-20">
          <div className="container mx-auto px-4">
            <div className="oa-faq-layout max-w-6xl mx-auto">
              <div className="oa-faq-intro">
                <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-3">
                  Before you install
                </p>
                <h2 className="display text-5xl md:text-6xl leading-[0.95]">
                  Questions,<br />
                  <span className="text-foreground/60">answered plainly.</span>
                </h2>
                <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-foreground/70">
                  Open source does not have to mean guesswork. Here is what runs,
                  where it runs, and who stays in control.
                </p>
              </div>

              <div className="oa-faq-list">
                {FAQS.map((item, index) => (
                  <details
                    key={item.question}
                    name="landing-faq"
                    className="oa-faq-item"
                    open={index === 0}
                  >
                    <summary>
                      <span>{item.question}</span>
                      <span className="oa-faq-toggle" aria-hidden>+</span>
                    </summary>
                    <div className="oa-faq-answer">
                      <p>{item.answer}</p>
                      <Link href={item.href} className="ink-link">
                        {item.linkLabel} →
                      </Link>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section id="get-started" data-section="final_cta" className="oa-final-cta relative pt-12 pb-20 md:pt-16 md:pb-24">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto relative">
              <div className="oa-final-panel px-8 py-14 md:px-14 md:py-20 text-center relative overflow-hidden">
                <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-4 relative z-[2]">
                  Open source · self-hosted
                </p>
                <h3 className="display text-4xl md:text-5xl leading-[1.05] mb-6 relative z-[2]">
                  Get OpenAlice.
                </h3>
                <p className="text-foreground/70 mb-8 max-w-md mx-auto relative z-[2]">
                  Download the local desk, then bring the coding agent and
                  subscriptions you already use.
                </p>
                <div className="oa-final-actions relative z-[2]">
                  <Link
                    href="/download"
                    data-evt="final_install"
                    data-target="download"
                    data-location="final"
                    className="cta-button cta-primary oa-final-primary"
                  >
                    Download OpenAlice
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
