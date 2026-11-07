import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { InstallOptions } from "./InstallOptions";
import { Nav } from "@/app/components/Nav";
import { Footer } from "@/app/components/Footer";
import { CopyCommandButton } from "@/app/components/CopyCommandButton";
import {
  Apple,
  ArrowUpRight,
  Server,
  TriangleAlert,
} from "lucide-react";
import { SOCIAL_IMAGE } from "@/app/lib/site";
import { mediaImage } from "@/lib/media";

const MAC_DOWNLOAD_URL = "https://download.openalice.ai/mac-arm64.dmg";
const MAC_INTEL_DOWNLOAD_URL = "https://download.openalice.ai/mac-x64.dmg";
const WINDOWS_DOWNLOAD_URL = "https://download.openalice.ai/windows-x64.exe";

export const metadata: Metadata = {
  title: "Download OpenAlice | Install the local trading desk",
  description:
    "Install OpenAlice with Shell, PowerShell, npm, Bun, or Homebrew. Choose desktop, source, or remote access for your workflow.",
  alternates: { canonical: "/download" },
  openGraph: {
    title: "Download OpenAlice | Install the local trading desk",
    description:
      "Choose the native CLI, desktop package, source checkout, or a private remote Machine.",
    url: "/download",
    type: "website",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Download OpenAlice | Install the local trading desk",
    description:
      "Choose the native CLI, desktop package, source checkout, or a private remote Machine.",
    images: [SOCIAL_IMAGE.url],
  },
};

const CLI_INSTALL_COMMAND = "curl -fsSL https://openalice.ai/install | bash";

const sourceCommands = [
  "git clone https://github.com/TraderAlice/OpenAlice.git",
  "cd OpenAlice",
  "pnpm install",
  "pnpm dev",
];

export default function DownloadPage() {
  return (
    <div className="oa-download dark min-h-screen bg-background">
      <Nav />

      <main>
        <section className="oa-download-shell border-b border-border/50">
          <div className="container mx-auto px-4 py-16 md:py-24">
            <div className="mx-auto max-w-6xl">
              <header className="oa-download-intro pb-10 md:pb-14" data-section="download_intro">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                    Download OpenAlice
                  </p>
                  <h1 className="mt-5 display leading-[0.92]">
                    Pick your route.
                  </h1>
                </div>
                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-foreground/66 md:text-base">
                  Install the native CLI on macOS, Linux, or Windows.
                  Choose your preferred installer, then launch your trading workspace.
                </p>
              </header>

              <section
                className="oa-download-recommended mb-4 grid overflow-hidden rounded-[16px] border border-border/65 bg-card/45 md:grid-cols-[20rem_minmax(0,1fr)]"
                data-section="download_recommended"
              >
                <div className="relative h-36 border-b border-border/55 bg-foreground/5 md:h-auto md:min-h-0 md:border-b-0 md:border-r">
                  <Image
                    {...mediaImage("/pic/product-agent-demo-260820.jpg")}
                    alt="The OpenAlice public demo ready for a coding agent session"
                    sizes="(max-width: 767px) calc(100vw - 2rem), 20rem"
                    className="h-full w-full object-cover object-left-top"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-background/28" />
                </div>
                <div className="p-4 md:p-8">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Native CLI · Stable
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                    One command to get started.
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/66 md:text-[15px]">
                    Use a direct installer or your package manager.
                    No source checkout or build step required.
                  </p>
                  <div className="mt-5">
                    <InstallOptions />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <ActionLink
                      href="/docs/getting-started/installation"
                      evt="download_recommended_installation"
                      target="installation_guide"
                      label="Installation guide"
                      primary
                    />
                    <ActionLink
                      href="https://github.com/TraderAlice/OpenAlice"
                      evt="download_recommended_github"
                      target="github_repo"
                      label="GitHub"
                      external
                    />
                  </div>
                </div>
              </section>

              <div className="oa-download-routes divide-y divide-border/55">
                <div className="oa-download-routes-heading">
                  <p>Other routes</p>
                  <span>Convenience installs, desktop packages, and remote deployments.</span>
                </div>
                <InstallSection
                  index="1"
                  title="Source checkout"
                  kicker="development"
                  sectionName="download_source"
                >
                  <CommandList commands={sourceCommands} />
                  <div className="mt-5 flex flex-wrap gap-2">
                    <CopyCommandButton
                      value={sourceCommands.join("\n")}
                      label="Copy source setup"
                      eventName="download_source_copy"
                      primary
                    />
                    <ActionLink
                      href="/docs/getting-started/developer-setup"
                      evt="download_source_guide"
                      target="source_install"
                      label="Source setup"
                    />
                    <ActionLink
                      href="https://github.com/TraderAlice/OpenAlice"
                      evt="download_source_github"
                      target="github_repo"
                      label="GitHub"
                      external
                    />
                  </div>
                </InstallSection>

                <CliSection command={CLI_INSTALL_COMMAND} />

                <InstallSection
                  index="2"
                  title="Desktop packages"
                  kicker="stable release"
                  sectionName="download_desktop"
                >
                  <div className="space-y-1">
                    <DownloadRow
                      icon={<Apple className="h-5 w-5" />}
                      title="macOS"
                      detail="Apple Silicon"
                      note="Signed and notarized stable-release DMG"
                      action={{
                        href: MAC_DOWNLOAD_URL,
                        evt: "download_macos_dmg",
                        target: "mac_download",
                        label: "Download DMG",
                        external: true,
                        primary: true,
                      }}
                    />
                    <DownloadRow
                      icon={<Apple className="h-5 w-5" />}
                      title="macOS"
                      detail="Intel"
                      note="Signed and notarized stable-release DMG"
                      action={{
                        href: MAC_INTEL_DOWNLOAD_URL,
                        evt: "download_macos_intel_dmg",
                        target: "mac_intel_download",
                        label: "Download DMG",
                        external: true,
                        primary: true,
                      }}
                    />
                    <DownloadRow
                      icon={<TriangleAlert className="h-5 w-5" />}
                      title="Windows"
                      detail="x64"
                      note="Stable-release installer; unsigned, so SmartScreen may warn"
                      action={{
                        href: "/docs/getting-started/install-windows",
                        evt: "download_windows_docs",
                        target: "windows_install",
                        label: "Windows setup",
                        primary: true,
                      }}
                      secondaryAction={{
                        href: WINDOWS_DOWNLOAD_URL,
                        evt: "download_windows_exe",
                        target: "windows_download",
                        label: "Unsigned .exe",
                        external: true,
                      }}
                    />
                  </div>
                </InstallSection>

                <InstallSection
                  index="3"
                  title="Server & remote"
                  kicker="private host"
                  sectionName="download_server"
                >
                  <div className="space-y-1">
                    <DownloadRow
                      icon={<Server className="h-5 w-5" />}
                      title="Private Machine"
                      detail="SSH + local relay"
                      note="Keep Alice on a private host and use its GUI locally"
                      action={{
                        href: "/docs/deployment/remote-access",
                        evt: "download_remote_access",
                        target: "remote_access",
                        label: "Remote guide",
                        primary: true,
                      }}
                    />
                  </div>
                </InstallSection>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function InstallSection({
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
      className="grid gap-5 py-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 md:py-9"
      data-section={sectionName}
    >
      <div>
        <p className="font-mono text-[13px] text-muted-foreground">[{index}]</p>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight md:mt-4">
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

function CliSection({ command }: { command: string }) {
  const previewCommand = command.replace("| bash", "| bash -s -- --channel beta");
  return (
    <section className="py-8 md:py-9" data-section="download_cli">
      <div className="grid gap-5 rounded-[14px] border border-border/70 bg-background/55 p-4 sm:p-5 md:grid-cols-[11rem_minmax(0,1fr)] md:items-start md:gap-x-8 lg:grid-cols-[12rem_minmax(0,1fr)] lg:p-7">
        <div className="md:row-span-2">
          <p className="font-mono text-[13px] text-muted-foreground">[1]</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight md:mt-2">
            Preview channels
          </h2>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            beta / dev
          </p>
        </div>
        <div className="min-w-0">
          <div className="break-words rounded-[10px] border border-border/55 bg-background/65 px-3 py-3 font-mono text-sm leading-relaxed text-foreground/78 sm:text-base">
            <span className="select-none text-muted-foreground">$ </span>
            <code>{previewCommand}</code>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-foreground/58">
            Use --channel dev for rolling development builds. PowerShell uses
            -Channel beta or -Channel dev. Package managers follow stable.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:col-start-2">
          <CopyCommandButton
            value={previewCommand}
            label="Copy command"
            eventName="download_cli_copy"
            primary
          />
          <ActionLink
            href="/docs/deployment/remote-access"
            evt="download_cli_guide"
            target="cli_install"
            label="CLI guide"
          />
          <ActionLink
            href="/docs/getting-started/quick-start"
            evt="download_cli_quick_start"
            target="quick_start"
            label="Quick start"
          />
        </div>
      </div>
    </section>
  );
}

function CommandList({ commands }: { commands: string[] }) {
  return (
    <div className="space-y-2 font-mono text-sm text-foreground/76">
      {commands.map((command) => (
        <div
          key={command}
          className="break-all rounded-[8px] border border-border/55 bg-background/45 px-3 py-2 leading-relaxed sm:break-normal"
        >
          <span className="select-none text-muted-foreground">$ </span>
          <code>{command}</code>
        </div>
      ))}
    </div>
  );
}

type Action = {
  external?: boolean;
  href: string;
  evt: string;
  target: string;
  label: string;
  primary?: boolean;
};

function DownloadRow({
  action,
  detail,
  icon,
  note,
  secondaryAction,
  title,
}: {
  action: Action;
  detail: string;
  icon: ReactNode;
  note: string;
  secondaryAction?: Action;
  title: string;
}) {
  return (
    <div className="grid gap-4 rounded-[12px] py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/7 text-foreground/64">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-xl font-semibold leading-tight">{title}</h3>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {detail}
            </p>
          </div>
          <p className="mt-1 text-sm text-foreground/58">{note}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <ActionLink {...action} />
        {secondaryAction && <ActionLink {...secondaryAction} />}
      </div>
    </div>
  );
}

function ActionLink({
  external,
  href,
  evt,
  label,
  primary = false,
  target,
}: Action) {
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
        rel="noopener"
        data-evt={evt}
        data-target={target}
        data-location="download"
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
      data-location="download"
      className={className}
    >
      {content}
    </Link>
  );
}
