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
  const e = newAnearEvent()
  await e.persist()
  await e.remove()
  const again = newAnearEvent()
  await again.persist()
  await again.remove()
})

test('zone', () => {
  const e = newAnearEvent()
  expect(e.zone.id).toBe('08dbf4ce-18b2-4d5a-a7d1-0c090b16251d')
})

test('app', () => {
  const e = newAnearEvent()
  expect(e.app.id).toBe('5b9d9838-17de-4a80-8a64-744c222ba722')
})

test('userId', () => {
  const e = newAnearEvent()
  expect(e.userId).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
})

test('zoneId', () => {
  const e = newAnearEvent()
  expect(e.zoneId).toBe('08dbf4ce-18b2-4d5a-a7d1-0c090b16251d')
})

test('eventState', () => {
  const e = newAnearEvent()
  expect(e.eventState).toBe('announce')
})

test('hosted false', () => {
  const e = newAnearEvent(false)
  expect(e.hosted).toBe(false)
})

test('hosted true', () => {
  const e = newAnearEvent(true)
  expect(e.hosted).toBe(true)
})

test('participantTimeout', () => {
  const e = newAnearEvent()
  expect(e.participantTimeout).toBe(32000)
})

test('hasFlag()', () => {
  const e = newAnearEvent()
  expect(e.hasFlag('foo')).toBe(false)
  expect(e.hasFlag('no_spectators')).toBe(true)
})

test('allowsSpectators()', () => {
  const e = newAnearEvent()
  expect(e.allowsSpectators()).toBe(false)
})

test('isPlayable()', () => {
  const e = newAnearEvent()
  expect(e.isPlayable()).toBe(true)
})

test('eventChannelName()', () => {
  const e = newAnearEvent()
  expect(e.eventChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:event')
})

test('participantsChannelName()', () => {
  const e = newAnearEvent()
  expect(e.participantsChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:participants')
})

test('actionsChannelName()', () => {
  const e = newAnearEvent()
  expect(e.actionsChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:actions')
})

test('spectatorsChannelName()', () => {
  const e = newAnearEvent()
  expect(e.spectatorsChannelName()).toBe('anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:spectators')
})
