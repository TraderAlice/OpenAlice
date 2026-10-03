import { describe, expect, it } from 'vitest'
import { parseGelonghuiResponse } from './gelonghui.js'

describe('parseGelonghuiResponse', () => {
  it('maps provider fields, filters invalid rows, and preserves returned row order', () => {
    const newestTimestamp = 1_742_000_000
    const olderTimestamp = 1_741_999_900
    const firstContent = 'Market update: rates moved lower. Full provider content.'
    const secondContent = 'Company announces quarterly results.'
    const payload = {
      statusCode: 200,
      message: 'OK',
      totalCount: 3,
      result: [
        {
          id: 91234,
          title: 'Rates move lower',
          content: firstContent,
          createTimestamp: newestTimestamp,
          route: 'https://www.gelonghui.com/live/brief/91234',
        },
        {
          id: 91232,
          title: 'Headline without body',
          createTimestamp: 1_742_000_050,
          route: 'https://www.gelonghui.com/live/brief/91232',
        },
        {
          id: 91233,
          title: '',
          content: secondContent,
          createTimestamp: olderTimestamp,
          route: 'https://www.gelonghui.com/live/brief/91233',
        },
      ],
    }

    expect(parseGelonghuiResponse(payload)).toEqual([
      {
        title: 'Rates move lower',
        content: firstContent,
        link: 'https://www.gelonghui.com/live/brief/91234',
        guid: '91234',
        pubDate: new Date(newestTimestamp * 1000),
      },
      {
        title: secondContent,
        content: secondContent,
        link: 'https://www.gelonghui.com/live/brief/91233',
        guid: '91233',
        pubDate: new Date(olderTimestamp * 1000),
      },
    ])
  })


  it('does not invent an article link when the provider omits its route', () => {
    expect(parseGelonghuiResponse({
      statusCode: 200,
      result: [{ id: 'without-route', title: 'Unlinked update', content: 'Provider content.' }],
    })).toEqual([{
      title: 'Unlinked update',
      content: 'Provider content.',
      guid: 'without-route',
      link: null,
      pubDate: null,
    }])
  })
  it.each([
    null,
    undefined,
    'not a provider response',
    { statusCode: 503, message: 'Unavailable', totalCount: 1, result: [] },
    { statusCode: 200, message: 'OK', totalCount: 1 },
    { statusCode: 200, message: 'OK', totalCount: 1, result: null },
    { statusCode: 200, message: 'OK', totalCount: 1, result: {} },
  ])('returns no items for malformed or unsuccessful payloads (%#)', (payload) => {
    expect(parseGelonghuiResponse(payload)).toEqual([])
  })

  it.each([
    null,
    {
      id: 91230,
      title: 'Headline without body',
      createTimestamp: 1_742_000_000,
      route: 'https://www.gelonghui.com/live/91230',
    },
    {
      id: 91231,
      title: 'Headline with blank body',
      content: '',
      createTimestamp: 1_742_000_000,
      route: 'https://www.gelonghui.com/live/91231',
    },
    {
      title: 'Body without id',
      content: 'Provider content',
      createTimestamp: 1_742_000_000,
      route: 'https://www.gelonghui.com/live/91229',
    },
    {
      id: ' ',
      title: 'Body with blank id',
      content: 'Provider content',
      createTimestamp: 1_742_000_000,
    },
    {
      id: null,
      title: 'Body with null id',
      content: 'Provider content',
      createTimestamp: 1_742_000_000,
      route: 'https://www.gelonghui.com/live/91228',
    },
  ])('returns no item for a row without usable content or id (%#)', (row) => {
    expect(parseGelonghuiResponse({
      statusCode: 200,
      message: 'OK',
      totalCount: 1,
      result: [row],
    })).toEqual([])
  })
})
