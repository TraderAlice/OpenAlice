/**
 * InvertirOnline (IOL) — type definitions.
 *
 * Config supports env-var indirection:
 *   "password": "$env:IOL_PASSWORD"   → reads process.env.IOL_PASSWORD at init
 *   "password": ""                     → falls back to process.env.IOL_PASSWORD
 *   "password": "literal"              → used as-is
 */

export interface IolBrokerConfig {
  id?: string
  label?: string
  /** Resolved at init() — may be empty until env fallback runs. */
  username: string
  /** Resolved at init() — may be empty until env fallback runs. */
  password: string
  /** Default market ("bCBA" for BYMA / Argentine equities). */
  market: string
  /** When true, the broker does not place real orders (for integration testing). */
  sandbox: boolean
}

// ==================== API response shapes (subset) ====================

export interface IolTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  '.issued'?: string
  '.expires'?: string
  userName?: string
}

/** Raw estadocuenta — IOL returns currency-scoped subaccounts. */
export interface IolEstadoCuenta {
  cuentas: IolCuenta[]
  estadisticas?: unknown[]
  totalEnPesos?: number
}

export interface IolCuenta {
  numero: string
  tipo: string                  // "inversion_Argentina_Pesos", "inversion_Estados_Unidos_Dolares", etc.
  moneda: string                // "peso_Argentino", "dolar_Estadounidense"
  disponible: number
  comprometido: number
  saldo: number
  titulosValorizados: number
  total: number
  margenDescubierto?: number
  estado?: string
}

export interface IolPortafolio {
  pais: string
  activos: IolActivo[]
}

export interface IolActivo {
  cantidad: number
  comprometido: number
  puntosVariacion: number
  variacionDiaria: number
  ultimoPrecio: number
  ppc: number                   // Precio Promedio de Compra (avg cost)
  gananciaPorcentaje: number
  gananciaDinero: number
  valorizado: number
  titulo: IolTitulo
  parking?: unknown
}

export interface IolTitulo {
  simbolo: string
  descripcion?: string
  pais?: string
  mercado: string               // "bCBA", "nYSE", "nASDAQ", "rOFX", ...
  tipo: string                  // "ACCIONES", "CEDEARS", "TITULOSPUBLICOS", ...
  plazo?: string
  moneda?: string               // "peso_Argentino", "dolar_Estadounidense"
}

export interface IolCotizacion {
  ultimoPrecio: number
  variacionPorcentual?: number
  apertura?: number
  maximo?: number
  minimo?: number
  ultimoCierre?: number
  volumenNominal?: number
  puntas?: {
    cantidadCompra?: number
    precioCompra?: number
    precioVenta?: number
    cantidadVenta?: number
  }
  puntasNegociables?: Array<{
    precioCompra?: number
    precioVenta?: number
    cantidadCompra?: number
    cantidadVenta?: number
  }>
  cantidadOperaciones?: number
  fecha?: string
  moneda?: string
}

export type IolCotizacionesResponse = unknown
export type IolCotizacionInstrumentosResponse = unknown
export type IolCotizacionPanelesResponse = unknown

export interface IolOperacion {
  numero: number
  fechaOrden: string
  tipo: string                  // "Compra", "Venta"
  estado: string                // "pendiente", "terminada", "cancelada", "rechazada", ...
  mercado: string
  simbolo: string
  cantidad: number
  precio?: number
  montoOperado?: number
  monto?: number
  cantidadOperada?: number
  precioOperado?: number
  modalidad?: string            // "precioLimite", "precioMercado"
  validez?: string
  plazo?: string                // "t0", "t1", "t2"
  moneda?: string
}

export interface IolPlaceOrderBody {
  mercado: string
  simbolo: string
  cantidad: number
  precio?: number
  validez: string               // ISO 8601; IOL uses yyyy-MM-dd'T'HH:mm:ss
  tipo: 'precioLimite' | 'precioMercado'
  plazo: 't0' | 't1' | 't2'
  idFuente?: number
}

export interface IolPlaceOrderResponse {
  ok: boolean
  numeroOperacion?: number
  mensajes?: string[]
  messages?: string[]
  description?: string
  message?: string
}
