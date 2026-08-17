import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAliceProjectRoutes } from './alice-project.js'

describe('AliceProject routes', () => {
  it('projects the stable identity of the complete-home runtime boundary', async () => {
    const response = await createAliceProjectRoutes({
      home: '/tmp/openalice-project-a',
      appRoot: '/tmp/openalice-source-a',
      env: {
        OPENALICE_PROJECT_KEY: 'research',
        OPENALICE_PROJECT_NAME: 'Research AliceProject',
      },
    }).request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      project: {
        id: expect.stringMatching(/^alice-project-/),
        key: 'research',
        displayName: 'Research AliceProject',
        home: resolve('/tmp/openalice-project-a'),
        appRoot: resolve('/tmp/openalice-source-a'),
        product: 'trader',
      },
    })
  })

  it('does not expose unrelated environment data', async () => {
    const response = await createAliceProjectRoutes({
      home: '/tmp/openalice-project-b',
      appRoot: null,
      env: { OPENAI_API_KEY: 'must-not-escape' },
    }).request('/')

    const body = JSON.stringify(await response.json())
    expect(body).not.toContain('must-not-escape')
    expect(body).not.toContain('OPENAI_API_KEY')
  })
})
