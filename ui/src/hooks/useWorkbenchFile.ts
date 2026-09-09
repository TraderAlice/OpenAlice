import { useEffect, useState } from 'react'
import { readWorkspaceFile, type ReadFileResult } from '../components/workspace/api'
export function useWorkbenchFile(wsId: string, path: string) {
  const [result, setResult] = useState<ReadFileResult | null>(null)
  useEffect(() => {
    let alive = true
    setResult(null)
    void readWorkspaceFile(wsId, path).then(
      (value) => { if (alive) setResult(value) },
      (error: unknown) => { if (alive) setResult({ kind: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { alive = false }
  }, [wsId, path])
  return result
}
