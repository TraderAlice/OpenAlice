import Image from "next/image";
import Link from "next/link";
import { getOpenAliceVersionLabel } from "@/app/lib/openalice-version";
import { GitHubStars } from "./GitHubStars";
import { MobileNav } from "./MobileNav";
import { mediaImage } from "@/lib/media";

const linkCls = "oa-nav-link";

type NavProps = {
  landing?: boolean;
};

export async function Nav({ landing = false }: NavProps) {
  const versionLabel = await getOpenAliceVersionLabel();

  return (
    <nav className="oa-nav sticky top-0 z-50">
      <a href="#main-content" className="oa-skip-link">
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-[90rem] items-center justify-between px-5 md:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <span className="oa-brand-mark">
            <Image
              {...mediaImage("/alice.png")}
              alt=""
              sizes="28px"
              className="h-7 w-auto"
            />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.03em]">OpenAlice</span>
        </Link>

        <div className="oa-nav-actions flex items-center gap-2 md:gap-8">
          <Link
            href="/docs"
            data-evt="nav_docs"
            data-target="docs"
            data-location="nav"
            className={`hidden md:inline-flex ${linkCls}`}
          >
            Docs
          </Link>
          {!landing && (
            <Link
              href="/blog"
              data-evt="nav_journal"
              data-target="blog"
              data-location="nav"
              className={`hidden md:inline-flex ${linkCls}`}
            >
              Journal
            </Link>
          )}
          <GitHubStars variant="nav" />
          <a
            href="https://demo.openalice.ai"
            target="_blank"
            rel="noopener"
            data-evt="nav_demo"
            data-target="demo"
            data-location="nav"
            className="oa-nav-install"
          >
            Demo
          </a>
          <MobileNav versionLabel={versionLabel} landing={landing} />
        </div>
      </div>
    </nav>
  );
}
