/** External Broker Packs resolve dependencies through their physical package.json. */
export const runtimeCompileOptions = {
  autoloadBunfig: false,
  autoloadDotenv: false,
  autoloadPackageJson: true,
} as const
