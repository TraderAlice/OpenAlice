export interface TranscriptFrame {
  /** Milliseconds since the start of the recording. */
  readonly atMs: number
  /** Base64-encoded PTY bytes (what the server sent down the WebSocket). */
  readonly bytesB64: string
}

export interface Transcript {
  /** Human-readable label shown in the demo terminal header. */
  readonly label: string
  /** Total duration in ms — `frames[last].atMs + tail`. */
  readonly durationMs: number
  /** Replay speed hint (1.0 = real time). Player may override. */
  readonly defaultSpeed?: number
  /** Frame sequence in ascending atMs order. */
  readonly frames: readonly TranscriptFrame[]
}
