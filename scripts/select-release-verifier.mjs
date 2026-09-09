import { appendFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function selectReleaseVerifier({ sourceSha, requestedSha, cwd = process.cwd() }) {
  const verifierSha = requestedSha || sourceSha
  if (![sourceSha, verifierSha].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? ''))) {
    throw new Error('Product and verifier must be full commit SHAs')
  }
  execFileSync('git', ['cat-file', '-e', `${verifierSha}^{commit}`], { cwd, stdio: 'pipe' })
  if (verifierSha !== sourceSha && !['origin/dev', 'origin/master'].some((ref) =>
    spawnSync('git', ['merge-base', '--is-ancestor', verifierSha, ref], { cwd, stdio: 'pipe' }).status === 0)) {
    throw new Error('Verifier must be integrated into dev or master')
  }
  return verifierSha
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const sha = selectReleaseVerifier({ sourceSha: process.env.GITHUB_SHA,
      requestedSha: process.env.RELEASE_VERIFIER_SHA })
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verifier_sha=${sha}\n`)
    console.log(`Selected desktop verifier ${sha}; product remains ${process.env.GITHUB_SHA}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
