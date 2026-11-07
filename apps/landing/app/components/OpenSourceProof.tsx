import Link from "next/link";
import { getOpenAliceVersionLabel } from "@/app/lib/openalice-version";

type RepositorySignals = {
  stargazers_count?: unknown;
  forks_count?: unknown;
  license?: {
    spdx_id?: unknown;
  } | null;
};

type RepositoryLicense = {
  html_url?: unknown;
};

function formatMetric(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  return value.toString();
}

async function getRepositorySignals() {
  try {
    const [response, licenseResponse] = await Promise.all([
      fetch("https://api.github.com/repos/TraderAlice/OpenAlice", {
        next: { revalidate: 60 * 60 },
      }),
      fetch("https://api.github.com/repos/TraderAlice/OpenAlice/license", {
        next: { revalidate: 60 * 60 },
      }),
    ]);

    if (!response.ok) return null;

    const repository = (await response.json()) as RepositorySignals;
    const licenseFile = licenseResponse.ok
      ? ((await licenseResponse.json()) as RepositoryLicense)
      : null;

    return {
      stars:
        typeof repository.stargazers_count === "number"
          ? repository.stargazers_count
          : null,
      forks:
        typeof repository.forks_count === "number"
          ? repository.forks_count
          : null,
      license:
        typeof repository.license?.spdx_id === "string"
          ? repository.license.spdx_id
          : "AGPL-3.0",
      licenseUrl:
        typeof licenseFile?.html_url === "string"
          ? licenseFile.html_url
          : "https://github.com/TraderAlice/OpenAlice/blob/master/LICENSE",
    };
  } catch {
    return null;
  }
}

export async function OpenSourceProof() {
  const [repository, versionLabel] = await Promise.all([
    getRepositorySignals(),
    getOpenAliceVersionLabel(),
  ]);

  const signals = [
    {
      value: repository?.stars ? formatMetric(repository.stars) : "GitHub",
      label: repository?.stars ? "stars" : "public source",
      href: "https://github.com/TraderAlice/OpenAlice",
      event: "proof_github_stars",
    },
    {
      value: repository?.forks ? formatMetric(repository.forks) : "Forkable",
      label: repository?.forks ? "forks" : "make it yours",
      href: "https://github.com/TraderAlice/OpenAlice/forks",
      event: "proof_github_forks",
    },
    {
      value: versionLabel,
      label: "current release",
      href: "/download",
      event: "proof_release",
    },
    {
      value: repository?.license ?? "AGPL-3.0",
      label: "open-source license",
      href:
        repository?.licenseUrl ??
        "https://github.com/TraderAlice/OpenAlice/blob/master/LICENSE",
      event: "proof_license",
    },
  ];

  return (
    <div className="oa-open-source-proof" aria-label="OpenAlice open-source project signals">
      {signals.map((signal) => {
        const content = (
          <>
            <strong>{signal.value}</strong>
            <span>{signal.label}</span>
          </>
        );

        if (signal.href.startsWith("/")) {
          return (
            <Link
              key={signal.label}
              href={signal.href}
              data-evt={signal.event}
              data-target="open_source_proof"
              data-location="manifesto"
            >
              {content}
            </Link>
          );
        }

        return (
          <a
            key={signal.label}
            href={signal.href}
            target="_blank"
            rel="noopener"
            data-evt={signal.event}
            data-target="open_source_proof"
            data-location="manifesto"
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}
