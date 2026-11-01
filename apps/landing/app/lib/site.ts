import { mediaImage } from "@/lib/media";

export const SITE_URL = "https://www.openalice.ai";

export const HOME_TITLE = "OpenAlice — Trade with a coding agent";
export const HOME_DESCRIPTION =
  "Trade with the coding agent you already use. OpenAlice turns trading into a coding task — open-source, self-hosted, every broker in one account. Works with Claude Code, Codex, OpenCode, and Pi.";

const socialImage = mediaImage("/og-v2.png");
export const SOCIAL_IMAGE = {
  url: socialImage.src,
  width: socialImage.width,
  height: socialImage.height,
  alt: "OpenAlice — Your coding agent can trade now",
} as const;
