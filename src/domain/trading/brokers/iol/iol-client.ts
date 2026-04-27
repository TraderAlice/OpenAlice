/**
 * IOL HTTP client — OAuth2 password grant + bearer-authenticated requests.
 *
 * The client owns token lifecycle: initial login, refresh on expiry, and
 * automatic re-auth when refresh_token is rejected. Credentials are only
 * held in memory, never logged.
 */

import { BrokerError } from '../types.js'
import type {
  IolTokenResponse,
  IolEstadoCuenta,
  IolPortafolio,
  IolCotizacion,
  IolCotizacionesResponse,
  IolCotizacionInstrumentosResponse,
  IolCotizacionPanelesResponse,
  IolOperacion,
  IolPlaceOrderBody,
  IolPlaceOrderResponse,
} from './iol-types.js'

const DEFAULT_BASE_URL = 'https://api.invertironline.com'
/** Refresh the access token when it expires within this many milliseconds. */
const REFRESH_SKEW_MS = 60_000

export class IolApiClient {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private expiresAt = 0
  private pending: Promise<void> | null = null

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  // ==================== Auth ====================

  /** Perform password-grant authentication. Overwrites any existing session. */
  async authenticate(): Promise<void> {
    const body = new URLSearchParams({
      username: this.username,
      password: this.password,
      grant_type: 'password',
    })
    const res = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      const detail = await safeText(res)
      throw new BrokerError(
        res.status === 400 || res.status === 401 ? 'AUTH' : 'NETWORK',
        `IOL /token failed (${res.status}): ${detail || res.statusText}`,
      )
    }
    const data = (await res.json()) as IolTokenResponse
    this.setSession(data)
  }

  /** Exchange the refresh token for a new access token; falls back to full re-auth on failure. */
  async refresh(): Promise<void> {
    if (!this.refreshToken) return this.authenticate()
    const body = new URLSearchParams({
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    })
    const res = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      // Refresh failed — drop tokens and re-auth
      this.accessToken = null
      this.refreshToken = null
      this.expiresAt = 0
      return this.authenticate()
    }
    const data = (await res.json()) as IolTokenResponse
    this.setSession(data)
  }

  private setSession(data: IolTokenResponse): void {
    this.accessToken = data.access_token
    this.refreshToken = data.refresh_token ?? this.refreshToken
    this.expiresAt = Date.now() + Math.max(0, data.expires_in * 1000)
  }

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() + REFRESH_SKEW_MS < this.expiresAt) return
    // De-duplicate concurrent refreshers
    if (!this.pending) {
      this.pending = (this.accessToken ? this.refresh() : this.authenticate())
        .finally(() => { this.pending = null })
    }
    await this.pending
  }

  // ==================== Core request ====================

  private async request<T>(method: string, path: string, init?: { body?: unknown; retryOn401?: boolean }): Promise<T> {
    await this.ensureToken()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
    }
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })

    // One-shot re-auth on 401 — covers server-side token invalidation
    if (res.status === 401 && init?.retryOn401 !== false) {
      this.accessToken = null
      await this.ensureToken()
      return this.request(method, path, { ...init, retryOn401: false })
    }

    if (!res.ok) {
      const detail = await safeText(res)
      throw BrokerError.from(new Error(`IOL ${method} ${path} failed (${res.status}): ${detail || res.statusText}`))
    }

    // DELETE /operaciones/{n} returns 204 No Content on success
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  // ==================== Typed endpoints ====================

  getEstadoCuenta(): Promise<IolEstadoCuenta> {
    return this.request('GET', '/api/v2/estadocuenta')
  }

  getPortafolio(pais = 'argentina'): Promise<IolPortafolio> {
    return this.request('GET', `/api/v2/portafolio/${encodeURIComponent(pais)}`)
  }

  /**
   * Fetch operations. Status filter accepts "todas", "pendientes", "terminadas".
   * Date range is required by the API — default to the last 30 days.
   */
  getOperaciones(opts?: { estado?: string; from?: Date; to?: Date }): Promise<IolOperacion[]> {
    const to = opts?.to ?? new Date()
    const from = opts?.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
    const params = new URLSearchParams({
      'filtro.estado': opts?.estado ?? 'todas',
      'filtro.fechaDesde': ymd(from),
      'filtro.fechaHasta': ymd(to),
    })
    return this.request('GET', `/api/v2/operaciones?${params}`)
  }

  getOperacion(numero: number | string): Promise<IolOperacion> {
    return this.request('GET', `/api/v2/operaciones/${encodeURIComponent(String(numero))}`)
  }

  cancelarOperacion(numero: number | string): Promise<void> {
    return this.request('DELETE', `/api/v2/operaciones/${encodeURIComponent(String(numero))}`)
  }

  getCotizacion(market: string, symbol: string): Promise<IolCotizacion> {
    return this.request('GET', `/api/v2/${encodeURIComponent(market)}/Titulos/${encodeURIComponent(symbol)}/Cotizacion`)
  }

  getCotizaciones(instrumento: string, panel: string, pais = 'argentina'): Promise<IolCotizacionesResponse> {
    return this.request('GET', `/api/v2/Cotizaciones/${encodeURIComponent(instrumento)}/${encodeURIComponent(panel)}/${encodeURIComponent(pais)}`)
  }

  getCotizacionInstrumentos(pais = 'argentina'): Promise<IolCotizacionInstrumentosResponse> {
    return this.request('GET', `/api/v2/${encodeURIComponent(pais)}/Titulos/Cotizacion/Instrumentos`)
  }

  getCotizacionPaneles(instrumento: string, pais = 'argentina'): Promise<IolCotizacionPanelesResponse> {
    return this.request('GET', `/api/v2/${encodeURIComponent(pais)}/Titulos/Cotizacion/Paneles/${encodeURIComponent(instrumento)}`)
  }

  comprar(body: IolPlaceOrderBody): Promise<IolPlaceOrderResponse> {
    return this.request('POST', '/api/v2/operar/Comprar', { body })
  }

  vender(body: IolPlaceOrderBody): Promise<IolPlaceOrderResponse> {
    return this.request('POST', '/api/v2/operar/Vender', { body })
  }
}

// ==================== Helpers ====================

function ymd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 500) } catch { return '' }
}
