function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return count.toString();
}

async function getStarCount(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/TraderAlice/OpenAlice",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

type GitHubStarsProps = {
  variant?: "hero" | "nav";
};

export async function GitHubStars({ variant = "hero" }: GitHubStarsProps = {}) {
  const stars = await getStarCount();

  if (variant === "nav") {
    return (
      <a
        href="https://github.com/TraderAlice/OpenAlice"
        target="_blank"
        rel="noopener"
        data-evt="nav_github"
        data-target="github_repo"
        data-location="nav"
        className="oa-nav-stars hidden md:inline-flex"
        aria-label={stars === null ? "OpenAlice on GitHub" : `${formatStars(stars)} stars on GitHub`}
      >
        <svg aria-hidden className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.334 3.859 1.4-8.168L.132 9.21l8.2-1.192z" />
        </svg>
        <span>{stars === null ? "GitHub" : "Star"}</span>
        {stars !== null && <strong>{formatStars(stars)}</strong>}
      </a>
    );
  }

  return (
    <a
      href="https://github.com/TraderAlice/OpenAlice"
      target="_blank"
      rel="noopener"
      data-evt="hero_github_stars"
      data-target="github_repo"
      data-location="hero"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.334 3.859 1.4-8.168L.132 9.21l8.2-1.192z" />
      </svg>
      {stars === null ? (
        <span>Open source on GitHub</span>
      ) : (
        <>
          <span className="font-medium">{formatStars(stars)}</span>
          <span>stars on GitHub</span>
        </>
      )}
    </a>
  );
}
