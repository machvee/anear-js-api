"use strict"
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')

const { AnearEventFixture: chatEvent } = require('./fixtures')

afterAll(async () => await AnearEvent.close())

afterEach(() => {jest.clearAllMocks()})

const newAnearEvent = (hosted = false) => {
  const e = new AnearEvent(chatEvent)
  e.attributes.hosted = hosted
  return e
}

test('can be persisted and removed repeatedly in storage', async () => {
  const t = newAnearEvent()
  await t.persist()
  await t.remove()
  const again = newAnearEvent()
  await again.persist()
  await again.remove()
})

test('userId', () => {
  const t = newAnearEvent()
  expect(t.userId).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
})

test('zoneId', () => {
  const t = newAnearEvent()
  expect(t.zoneId).toBe('08dbf4ce-18b2-4d5a-a7d1-0c090b16251d')
})

test('eventState', () => {
  const t = newAnearEvent()
  expect(t.eventState).toBe('announce')
})

test('hosted false', () => {
  const t = newAnearEvent(false)
  expect(t.hosted).toBe(false)
})

test('hosted true', () => {
  const t = newAnearEvent(true)
  expect(t.hosted).toBe(true)
})

test('participantTimeout', () => {
  const t = newAnearEvent()
  expect(t.participantTimeout).toBe(32000)
})

test('hasFlag()', () => {
  const t = newAnearEvent()
  expect(t.hasFlag('foo')).toBe(false)
  expect(t.hasFlag('no_spectators')).toBe(true)
})

test('allowsSpectators()', () => {
  const t = newAnearEvent()
  expect(t.allowsSpectators()).toBe(false)
})

test('isPlayable()', () => {
  const t = newAnearEvent()
  expect(t.isPlayable()).toBe(true)
})

test('eventChannelName()', () => {
  const t = newAnearEvent()
  expect(t.eventChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:event')
})

test('participantsChannelName()', () => {
  const t = newAnearEvent()
  expect(t.participantsChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:participants')
})

test('actionsChannelName()', () => {
  const t = newAnearEvent()
  expect(t.actionsChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:actions')
})

test('spectatorsChannelName()', () => {
  const t = newAnearEvent()
  expect(t.spectatorsChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:spectators')
})
