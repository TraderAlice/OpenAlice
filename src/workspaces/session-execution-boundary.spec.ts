import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return (await Promise.all(entries.map(row => row.isDirectory() ? sources(join(dir, row.name)) : Promise.resolve(/\.tsx?$/.test(row.name) && !/\.(spec|test)\./.test(row.name) && !row.name.includes('fixture') ? [join(dir, row.name)] : [])))).flat()
}

it('keeps process-control containers and Session state writes behind the execution composition root', async () => {
  const violations: string[] = []
  for (const path of await sources(join(process.cwd(), 'src'))) {
    const name = relative(process.cwd(), path).replaceAll('\\', '/')
    const text = await readFile(path, 'utf8')
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    const composition = name === 'src/workspaces/service.ts'
    function walk(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text
        const receiver = node.expression.expression.getText(file)
        if (!composition && /(?:^|\.)(?:pool|web)$/.test(receiver) && ['spawn', 'start', 'stop', 'dispose', 'disposeToken', 'disposeAll', 'stopAll'].includes(method)) violations.push(`${name}: unmanaged ${receiver}.${method}`)
        if (method === 'projectExecution' && !composition) violations.push(`${name}: state projection outside composition root`)
        if (['startWebSession', 'dispatchHeadlessTask'].includes(method)) violations.push(`${name}: retired launch interface ${method}`)
      }
      if (ts.isNewExpression(node) && ['SessionPool', 'WebSessionHost'].includes(node.expression.getText(file)) && !composition) violations.push(`${name}: unmanaged process host`)
      ts.forEachChild(node, walk)
    }
    walk(file)
  }
  expect(violations).toEqual([])
})
