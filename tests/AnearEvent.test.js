"use strict"

const AnearEvent = require('../lib/models/AnearEvent')
const { AnearEventFixture } = require('./fixtures')

const newAnearEvent = (hosted = false) => {
  const event = new AnearEvent(AnearEventFixture)
  event.attributes.hosted = hosted
  return event
}

describe('AnearEvent', () => {
  let anearEvent

  beforeEach(() => {
    anearEvent = newAnearEvent()
  })

  test('constructor', () => {
    expect(anearEvent.zone.id).toBe('08dbf4ce-18b2-4d5a-a7d1-0c090b16251d')
    expect(anearEvent.app.id).toBe('5b9d9838-17de-4a80-8a64-744c222ba722')
    expect(anearEvent.userId).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
    expect(anearEvent.zoneId).toBe('08dbf4ce-18b2-4d5a-a7d1-0c090b16251d')
    expect(anearEvent.eventState).toBe('announce')
    expect(anearEvent.hosted).toBe(false)
  })

  test('setMachine registers a send function', () => {
    const mockService = { send: jest.fn() }
    anearEvent.setMachine(mockService)
    anearEvent.announceEvent()
    expect(mockService.send).toHaveBeenCalledWith('ANNOUNCE')
  })

  test('can be hosted', () => {
    const hostedEvent = newAnearEvent(true)
    expect(hostedEvent.hosted).toBe(true)
  })

  test('participantTimeout', () => {
    expect(anearEvent.participantTimeout).toBe(32000)
  })

  test('hasFlag returns correct values', () => {
    expect(anearEvent.hasFlag('foo')).toBe(false)
    expect(anearEvent.hasFlag('no_spectators')).toBe(true)
  })

  test('allowsSpectators is false when no_spectators flag is present', () => {
    expect(anearEvent.allowsSpectators()).toBe(false)
  })

  test('isPlayable returns true for playable states', () => {
    anearEvent.attributes.state = 'announce'
    expect(anearEvent.isPlayable()).toBe(true)
    anearEvent.attributes.state = 'live'
    expect(anearEvent.isPlayable()).toBe(true)
  })

  test('isPlayable returns false for unplayable states', () => {
    anearEvent.attributes.state = 'closing'
    expect(anearEvent.isPlayable()).toBe(false)
    anearEvent.attributes.state = 'closed'
    expect(anearEvent.isPlayable()).toBe(false)
    anearEvent.attributes.state = 'canceled'
    expect(anearEvent.isPlayable()).toBe(false)
  })

  describe('channel name getters', () => {
    test('eventChannelName', () => {
      expect(anearEvent.eventChannelName).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:event')
    })

    test('participantsChannelName', () => {
      expect(anearEvent.participantsChannelName).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:participants')
    })

    test('actionsChannelName', () => {
      expect(anearEvent.actionsChannelName).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:actions')
    })

    test('spectatorsChannelName', () => {
      expect(anearEvent.spectatorsChannelName).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:spectators')
    })
  })

  describe('state machine interactions', () => {
    const mockService = { send: jest.fn() }

    beforeEach(() => {
      anearEvent.setMachine(mockService)
      mockService.send.mockClear()
    })

    test('announceEvent sends ANNOUNCE', () => {
      anearEvent.announceEvent()
      expect(mockService.send).toHaveBeenCalledWith('ANNOUNCE')
    })

    test('startEvent sends START', () => {
      anearEvent.startEvent()
      expect(mockService.send).toHaveBeenCalledWith('START')
    })

    test('cancelEvent sends CANCEL', () => {
      anearEvent.cancelEvent()
      expect(mockService.send).toHaveBeenCalledWith('CANCEL')
    })

    test('closeEvent sends CLOSE', () => {
      anearEvent.closeEvent()
      expect(mockService.send).toHaveBeenCalledWith('CLOSE')
    })

    test('pauseEvent sends PAUSE', () => {
      anearEvent.pauseEvent()
      expect(mockService.send).toHaveBeenCalledWith('PAUSE')
    })

    test('resumeEvent sends RESUME', () => {
      anearEvent.resumeEvent()
      expect(mockService.send).toHaveBeenCalledWith('RESUME')
    })
  })
})
