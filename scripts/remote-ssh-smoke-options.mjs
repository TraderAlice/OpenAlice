export function parseRemoteSshSmokeOptions(argv) {
  const options = {
    help: false,
    image: undefined,
    keepContainer: false,
    keepImage: false,
    skipBuild: false,
    skipTui: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--keep-image') {
      options.keepImage = true
      continue
    }
    if (arg === '--keep-container') {
      options.keepContainer = true
      continue
    }
    if (arg === '--skip-tui') {
      options.skipTui = true
      continue
    }
    if (arg === '--skip-build') {
      options.skipBuild = true
      continue
    }
    if (arg === '--image') {
      const value = argv[index + 1]
      if (!value || value === '--' || value.startsWith('-')) {
        throw new Error('--image requires a Docker image name')
      }
      options.image = value
      index += 1
      continue
    }
    throw new Error(`unknown option: ${arg}`)
  }

  if (options.skipBuild && !options.image) {
    throw new Error('--skip-build requires --image <name>')
  }

  return options
}
