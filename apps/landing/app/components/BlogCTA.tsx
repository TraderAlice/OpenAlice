import Image from "next/image";
import { mediaImage } from "@/lib/media";

export function BlogCTA() {
  return (
    <div className="mt-16 pt-10 border-t border-border/60" data-section="blog_cta">
      <div className="relative rounded-[20px] border border-border/60 bg-card/60 p-10 md:p-12 text-center overflow-hidden grain">
        <div
          className="hidden md:block absolute -top-4 right-8 w-20 sticker"
          style={{ ["--tilt" as string]: "8deg" }}
        >
          <Image
            {...mediaImage("/sticker/alice_smile.png")}
            alt=""
            sizes="80px"
            className="w-full h-auto"
          />
        </div>
        <p className="font-mono text-[10.5px] tracking-[0.28em] uppercase text-muted-foreground mb-3 relative z-[2]">
          Down the rabbit hole
        </p>
        <h3 className="display text-3xl md:text-4xl mb-4 relative z-[2]">
          Tell Alice your strategy. <br /> Watch her take the desk.
        </h3>
        <a
          href="https://github.com/TraderAlice/OpenAlice"
          target="_blank"
          rel="noopener"
          data-evt="blog_cta_clone"
          data-target="github_repo"
          data-location="blog_cta"
          className="relative z-[2] inline-flex items-center gap-2 mt-2 px-6 py-3 rounded-full bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
        >
          git clone OpenAlice →
        </a>
      </div>
    </div>
  );
}
