import { describe, expect, it, vi } from 'vitest'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { IN } from '../src/message.js'
import { DefaultEWrapper } from '../src/wrapper.js'

function createDecoder(): { decoder: Decoder; wrapper: DefaultEWrapper } {
  const wrapper = new DefaultEWrapper()
  const decoder = new Decoder(wrapper, 206)
  applyAllHandlers(decoder)
  return { decoder, wrapper }
}

describe('Decoder text miscellaneous payloads', () => {
  it('decodes error and time payloads without a payload msgId', () => {
    const { decoder, wrapper } = createDecoder()
    const error = vi.spyOn(wrapper, 'error')
    const currentTime = vi.spyOn(wrapper, 'currentTime')
    const currentTimeInMillis = vi.spyOn(wrapper, 'currentTimeInMillis')

    decoder.interpret(IN.ERR_MSG, [
      '81', '321', 'bad contract', '{"reason":"test"}', '1784289600',
    ])
    decoder.interpret(IN.CURRENT_TIME, ['1', '1784289600'])
    decoder.interpret(IN.CURRENT_TIME_IN_MILLIS, ['1784289600123'])

    expect(error).toHaveBeenCalledWith(
      81, 1784289600, 321, 'bad contract', '{"reason":"test"}',
    )
    expect(currentTime).toHaveBeenCalledWith(1784289600)
    expect(currentTimeInMillis).toHaveBeenCalledWith(1784289600123)
  })

  it('decodes scanner parameter and scanner row payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const scannerParameters = vi.spyOn(wrapper, 'scannerParameters')
    const scannerData = vi.spyOn(wrapper, 'scannerData')
    const scannerDataEnd = vi.spyOn(wrapper, 'scannerDataEnd')

    decoder.interpret(IN.SCANNER_PARAMETERS, ['1', '<scan/>'])
    decoder.interpret(IN.SCANNER_DATA, [
      '1',
      '91',
      '1',
      '0',
      '265598',
      'AAPL',
      'STK',
      '',
      '0',
      '',
      'SMART',
      'USD',
      'AAPL',
      'NASDAQ.NMS',
      'NMS',
      '1.0',
      'SPX',
      'UP',
      '',
    ])

    expect(scannerParameters).toHaveBeenCalledWith('<scan/>')
    expect(scannerData).toHaveBeenCalledOnce()
    expect(scannerData.mock.calls[0][0]).toBe(91)
    expect(scannerData.mock.calls[0][1]).toBe(0)
    expect(scannerData.mock.calls[0][2]).toMatchObject({
      contract: { conId: 265598, symbol: 'AAPL', secType: 'STK' },
      marketName: 'NASDAQ.NMS',
    })
    expect(scannerData.mock.calls[0].slice(3)).toEqual(['1.0', 'SPX', 'UP', ''])
    expect(scannerDataEnd).toHaveBeenCalledWith(91)
  })

  it('decodes bulletin, FA, fundamental, and news payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const updateNewsBulletin = vi.spyOn(wrapper, 'updateNewsBulletin')
    const receiveFA = vi.spyOn(wrapper, 'receiveFA')
    const fundamentalData = vi.spyOn(wrapper, 'fundamentalData')
    const newsProviders = vi.spyOn(wrapper, 'newsProviders')
    const newsArticle = vi.spyOn(wrapper, 'newsArticle')
    const tickNews = vi.spyOn(wrapper, 'tickNews')
    const historicalNews = vi.spyOn(wrapper, 'historicalNews')
    const historicalNewsEnd = vi.spyOn(wrapper, 'historicalNewsEnd')

    decoder.interpret(IN.NEWS_BULLETINS, ['1', '7', '2', 'headline', 'NYSE'])
    decoder.interpret(IN.RECEIVE_FA, ['1', '3', '<fa/>'])
    decoder.interpret(IN.FUNDAMENTAL_DATA, ['1', '101', '<fund/>'])
    decoder.interpret(IN.NEWS_PROVIDERS, ['1', 'BRFG', 'Briefing.com'])
    decoder.interpret(IN.NEWS_ARTICLE, ['102', '0', 'article'])
    decoder.interpret(IN.TICK_NEWS, [
      '103', '1784289600', 'BRFG', 'A-1', 'headline', 'extra',
    ])
    decoder.interpret(IN.HISTORICAL_NEWS, [
      '104', '20260717 12:00:00', 'BRFG', 'A-1', 'headline',
    ])
    decoder.interpret(IN.HISTORICAL_NEWS_END, ['104', '1'])

    expect(updateNewsBulletin).toHaveBeenCalledWith(7, 2, 'headline', 'NYSE')
    expect(receiveFA).toHaveBeenCalledWith(3, '<fa/>')
    expect(fundamentalData).toHaveBeenCalledWith(101, '<fund/>')
    expect(newsProviders).toHaveBeenCalledWith([
      expect.objectContaining({ code: 'BRFG', name: 'Briefing.com' }),
    ])
    expect(newsArticle).toHaveBeenCalledWith(102, 0, 'article')
    expect(tickNews).toHaveBeenCalledWith(
      103, 1784289600, 'BRFG', 'A-1', 'headline', 'extra',
    )
    expect(historicalNews).toHaveBeenCalledWith(
      104, '20260717 12:00:00', 'BRFG', 'A-1', 'headline',
    )
    expect(historicalNewsEnd).toHaveBeenCalledWith(104, true)
  })

  it('decodes option metadata and market-directory payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const securityDefinitionOptionParameter = vi.spyOn(wrapper, 'securityDefinitionOptionParameter')
    const securityDefinitionOptionParameterEnd = vi.spyOn(wrapper, 'securityDefinitionOptionParameterEnd')
    const softDollarTiers = vi.spyOn(wrapper, 'softDollarTiers')
    const familyCodes = vi.spyOn(wrapper, 'familyCodes')
    const smartComponents = vi.spyOn(wrapper, 'smartComponents')
    const mktDepthExchanges = vi.spyOn(wrapper, 'mktDepthExchanges')

    decoder.interpret(IN.SECURITY_DEFINITION_OPTION_PARAMETER, [
      '111', 'SMART', '265598', 'AAPL', '100',
      '2', '20260821', '20260918',
      '2', '250', '260',
    ])
    decoder.interpret(IN.SECURITY_DEFINITION_OPTION_PARAMETER_END, ['111'])
    decoder.interpret(IN.SOFT_DOLLAR_TIERS, ['112', '1', 'TIER', 'VALUE', 'Display'])
    decoder.interpret(IN.FAMILY_CODES, ['1', 'DU_TEST', 'FAMILY'])
    decoder.interpret(IN.SMART_COMPONENTS, ['113', '1', '1', 'NASDAQ', 'Q'])
    decoder.interpret(IN.MKT_DEPTH_EXCHANGES, [
      '1', 'NASDAQ', 'STK', 'NASDAQ', 'Deep2', '7',
    ])

    expect(securityDefinitionOptionParameter).toHaveBeenCalledWith(
      111,
      'SMART',
      265598,
      'AAPL',
      '100',
      new Set(['20260821', '20260918']),
      new Set([250, 260]),
    )
    expect(securityDefinitionOptionParameterEnd).toHaveBeenCalledWith(111)
    expect(softDollarTiers).toHaveBeenCalledWith(112, [
      expect.objectContaining({ name: 'TIER', val: 'VALUE', displayName: 'Display' }),
    ])
    expect(familyCodes).toHaveBeenCalledWith([
      expect.objectContaining({ accountID: 'DU_TEST', familyCodeStr: 'FAMILY' }),
    ])
    expect(smartComponents).toHaveBeenCalledWith(113, [
      expect.objectContaining({ bitNumber: 1, exchange: 'NASDAQ', exchangeLetter: 'Q' }),
    ])
    expect(mktDepthExchanges).toHaveBeenCalledWith([
      expect.objectContaining({
        exchange: 'NASDAQ',
        secType: 'STK',
        listingExch: 'NASDAQ',
        serviceDataType: 'Deep2',
        aggGroup: 7,
      }),
    ])
  })

  it('decodes verification and display-group payloads from their version field', () => {
    const { decoder, wrapper } = createDecoder()
    const verifyMessageAPI = vi.spyOn(wrapper, 'verifyMessageAPI')
    const verifyCompleted = vi.spyOn(wrapper, 'verifyCompleted')
    const verifyAndAuthMessageAPI = vi.spyOn(wrapper, 'verifyAndAuthMessageAPI')
    const verifyAndAuthCompleted = vi.spyOn(wrapper, 'verifyAndAuthCompleted')
    const displayGroupList = vi.spyOn(wrapper, 'displayGroupList')
    const displayGroupUpdated = vi.spyOn(wrapper, 'displayGroupUpdated')

    decoder.interpret(IN.VERIFY_MESSAGE_API, ['1', 'api-data'])
    decoder.interpret(IN.VERIFY_COMPLETED, ['1', '1', ''])
    decoder.interpret(IN.VERIFY_AND_AUTH_MESSAGE_API, ['1', 'api-data', 'challenge'])
    decoder.interpret(IN.VERIFY_AND_AUTH_COMPLETED, ['1', '0', 'denied'])
    decoder.interpret(IN.DISPLAY_GROUP_LIST, ['1', '121', '1|Group'])
    decoder.interpret(IN.DISPLAY_GROUP_UPDATED, ['1', '122', '265598@SMART'])

    expect(verifyMessageAPI).toHaveBeenCalledWith('api-data')
    expect(verifyCompleted).toHaveBeenCalledWith(true, '')
    expect(verifyAndAuthMessageAPI).toHaveBeenCalledWith('api-data', 'challenge')
    expect(verifyAndAuthCompleted).toHaveBeenCalledWith(false, 'denied')
    expect(displayGroupList).toHaveBeenCalledWith(121, '1|Group')
    expect(displayGroupUpdated).toHaveBeenCalledWith(122, '265598@SMART')
  })

  it('decodes WSH, user-info, and FA-replacement payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const wshMetaData = vi.spyOn(wrapper, 'wshMetaData')
    const wshEventData = vi.spyOn(wrapper, 'wshEventData')
    const userInfo = vi.spyOn(wrapper, 'userInfo')
    const replaceFAEnd = vi.spyOn(wrapper, 'replaceFAEnd')

    decoder.interpret(IN.WSH_META_DATA, ['131', '{"meta":true}'])
    decoder.interpret(IN.WSH_EVENT_DATA, ['132', '{"event":true}'])
    decoder.interpret(IN.USER_INFO, ['133', 'brand'])
    decoder.interpret(IN.REPLACE_FA_END, ['134', 'done'])

    expect(wshMetaData).toHaveBeenCalledWith(131, '{"meta":true}')
    expect(wshEventData).toHaveBeenCalledWith(132, '{"event":true}')
    expect(userInfo).toHaveBeenCalledWith(133, 'brand')
    expect(replaceFAEnd).toHaveBeenCalledWith(134, 'done')
  })
})
