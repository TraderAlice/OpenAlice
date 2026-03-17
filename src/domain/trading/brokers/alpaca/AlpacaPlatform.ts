import type { IPlatform, PlatformCredentials } from '../factory.js'
import { AlpacaBroker } from './AlpacaBroker.js'

export interface AlpacaPlatformConfig {
  id: string
  label?: string
  paper: boolean
}

export class AlpacaPlatform implements IPlatform {
  readonly id: string
  readonly label: string
  readonly providerType = 'alpaca'

  private readonly config: AlpacaPlatformConfig

  constructor(config: AlpacaPlatformConfig) {
    this.config = config
    this.id = config.id
    this.label = config.label ?? (config.paper ? 'Alpaca Paper' : 'Alpaca Live')
  }

  createAccount(credentials: PlatformCredentials): AlpacaBroker {
    return new AlpacaBroker({
      id: credentials.id,
      label: credentials.label,
      apiKey: credentials.apiKey ?? '',
      secretKey: credentials.apiSecret ?? '',
      paper: this.config.paper,
    })
  }
}
