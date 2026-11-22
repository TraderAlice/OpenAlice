import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Nav } from "@/app/components/Nav";
import { Footer } from "@/app/components/Footer";
import { SOCIAL_IMAGE } from "@/app/lib/site";

const title = "Code Signing & Privacy Policy | OpenAlice";
const description =
  "Code Signing Policy, build origin verification, team roles, and Privacy Policy for official OpenAlice Windows Desktop releases.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/code-signing" },
  openGraph: {
    title,
    description,
    url: "/code-signing",
    type: "website",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [SOCIAL_IMAGE.url],
  },
};

export default function CodeSigningPage() {
  return (
    <div className="oa-download dark min-h-screen bg-background">
      <Nav />

      <main id="main-content">
        <section className="oa-download-shell border-b border-border/50">
          <div className="container mx-auto px-4 py-16 md:py-24">
            <div className="mx-auto max-w-6xl">
              <header
                className="grid gap-6 pb-10 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] md:items-end md:gap-14 md:pb-14"
                data-section="code_signing_intro"
              >
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                    Trust &amp; Verification
                  </p>
                  <h1 className="mt-5 display text-4xl leading-[0.95] sm:text-5xl md:text-6xl">
                    Code Signing &amp; Privacy Policy
                  </h1>
                </div>
                <p className="border-t border-border/60 pt-5 text-[15px] leading-relaxed text-foreground/66 md:mb-1 md:border-t-0 md:border-l md:border-border/70 md:pt-0 md:pl-6 md:text-base">
                  Public signing governance, build origin verification, team roles,
                  and privacy policy for official OpenAlice Windows Desktop releases.
                </p>
              </header>

              <div className="divide-y divide-border/55 border-t border-border/65">
                <PolicySection
                  index="1"
                  title="Code Signing Policy"
                  kicker="attribution & scope"
                  sectionName="code_signing_policy"
                >
                  <div className="space-y-4 text-[15px] leading-relaxed text-foreground/78 md:text-base">
                    <p className="rounded-[12px] border border-border/70 bg-[#0a0a0b]/85 px-4 py-4 text-foreground/90 sm:px-5">
                      Free code signing provided by{" "}
                      <a
                        href="https://signpath.io/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground ink-link"
                      >
                        SignPath.io
                      </a>
                      , certificate by{" "}
                      <a
                        href="https://signpath.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground ink-link"
                      >
                        SignPath Foundation
                      </a>
                      .
                    </p>
                    <p className="max-w-3xl text-foreground/70">
                      This policy applies to official OpenAlice Windows Desktop releases
                      published from{" "}
                      <a
                        href="https://github.com/TraderAlice/OpenAlice"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[14px] text-foreground/88 ink-link hover:text-foreground"
                      >
                        TraderAlice/OpenAlice
                      </a>
                      .
                    </p>
                  </div>
                </PolicySection>

                <PolicySection
                  index="2"
                  title="Build & Origin"
                  kicker="github actions"
                  sectionName="code_signing_origin"
                >
                  <p className="max-w-3xl text-[15px] leading-relaxed text-foreground/72 md:text-base">
                    Official Windows installers are built on GitHub-hosted runners from{" "}
                    <code className="rounded border border-border/60 bg-background/70 px-1.5 py-0.5 font-mono text-[13px] text-foreground/88">
                      TraderAlice/OpenAlice
                    </code>{" "}
                    release commits and submitted to SignPath with GitHub Actions origin
                    verification.
                  </p>
                </PolicySection>

                <PolicySection
                  index="3"
                  title="Team Roles"
                  kicker="governance"
                  sectionName="code_signing_roles"
                >
                  <dl className="divide-y divide-border/55 overflow-hidden rounded-[12px] border border-border/65 bg-[#0a0a0b]/75">
                    <div className="grid gap-2 p-4 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-6 sm:p-5">
                      <dt className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Committers &amp; Reviewers
                      </dt>
                      <dd className="text-sm leading-relaxed text-foreground/76 sm:text-[15px]">
                        <a
                          href="https://github.com/luokerenx4"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-foreground ink-link"
                        >
                          @luokerenx4
                        </a>{" "}
                        <span className="text-foreground/62">
                          (
                          <code className="font-mono text-[13px]">
                            TraderAlice/OpenAlice
                          </code>{" "}
                          maintainer)
                        </span>
                      </dd>
                    </div>
                    <div className="grid gap-2 p-4 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-6 sm:p-5">
                      <dt className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Approvers
                      </dt>
                      <dd className="text-sm leading-relaxed text-foreground/76 sm:text-[15px]">
                        <a
                          href="https://github.com/luokerenx4"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-foreground ink-link"
                        >
                          @luokerenx4
                        </a>{" "}
                        <span className="text-foreground/62">
                          (SignPath organization administrator; manually reviews and
                          approves signing requests in the SignPath UI)
                        </span>
                      </dd>
                    </div>
                  </dl>
                </PolicySection>

                <PolicySection
                  index="4"
                  title="Privacy Policy"
                  kicker="network & data"
                  sectionName="code_signing_privacy"
                >
                  <p className="max-w-3xl text-[15px] leading-relaxed text-foreground/78 md:text-base">
                    This program will not transfer any information to other networked
                    systems unless specifically requested by the user or the person
                    installing or operating it.
                  </p>
                </PolicySection>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border/55 pt-8">
                <PolicyActionLink
                  href="/download"
                  evt="code_signing_download"
                  target="download"
                  label="Download OpenAlice"
                  primary
                />
                <PolicyActionLink
                  href="https://github.com/TraderAlice/OpenAlice"
                  evt="code_signing_github"
                  target="github_repo"
                  label="GitHub repository"
                  external
                />
                <PolicyActionLink
                  href="https://github.com/TraderAlice/OpenAlice/releases"
                  evt="code_signing_releases"
                  target="github_releases"
                  label="Official releases"
                  external
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function PolicySection({
  children,
  index,
  kicker,
  sectionName,
  title,
}: {
  children: ReactNode;
  index: string;
  kicker: string;
  sectionName: string;
  title: string;
}) {
  return (
    <section
      className="grid gap-5 py-8 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10 md:py-10"
      data-section={sectionName}
    >
      <div>
        <p className="font-mono text-[13px] text-muted-foreground">[{index}]</p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[#e6e6e2]">
          {title}
        </h2>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {kicker}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function PolicyActionLink({
  external,
  href,
  evt,
  label,
  primary = false,
  target,
}: {
  external?: boolean;
  href: string;
  evt: string;
  label: string;
  primary?: boolean;
  target: string;
}) {
  const className = [
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
    primary
      ? "bg-foreground text-background hover:bg-foreground/90"
      : "border border-foreground/20 bg-background/55 text-foreground/72 hover:border-foreground/35 hover:text-foreground",
  ].join(" ");

  const content = (
    <>
      {label}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-evt={evt}
        data-target={target}
        data-location="code_signing"
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={href}
      data-evt={evt}
      data-target={target}
      data-location="code_signing"
      className={className}
    >
      {content}
    </Link>
  );
}
