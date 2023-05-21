const AnearParticipant = require('../lib/models/AnearParticipant')

const { AnearParticipantFixture1: player1 } =  require('./fixtures')

const MockEvent = {}

afterAll(async () => await AnearParticipant.close())

test('constructor', () =>  {
  const t = new AnearParticipant(player1, MockEvent)
  expect(t.id).toBe(player1.data.id)
  expect(t.relationships.user.data.type).toBe("users")
  expect(t.anearEvent).toBe(MockEvent)
})

test('participant can be repeatedly rehydrated and updated', async () => {
  const participant = new AnearParticipant(player1, MockEvent)
  await participant.persist()

  let p = await AnearParticipant.getFromStorage(player1.data.id, MockEvent)

  expect(p.anearEvent).toBe(MockEvent)

  await p.update()

  p = await AnearParticipant.getFromStorage(player1.data.id, MockEvent)
  expect(p.anearEvent).toBe(MockEvent)

  await p.remove()
})

test('userId', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.userId).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
})

test('userType', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.userType).toBe('participant')
})

test('isHost false', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.isHost()).toBe(false)
})

test('isHost true', () => {
  const p = new AnearParticipant(player1, MockEvent)
  p.data.attributes['user-type'] = 'host'
  expect(p.isHost()).toBe(true)
})

test('eventId', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.eventId).toBe('b2aa5a28-2aa1-4ba7-8e2f-fe11dfe1b971')
})

test('user', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.user.id).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
  expect(p.user.attributes.name).toBe('dave_mcvicar')
})

test('profile', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.profile.id).toBe('a04976a9-1c08-4bc6-b381-7f0d0637b919')
  expect(p.profile.attributes['last-name']).toBe('McVicar')
})

test('name', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.name).toBe('machvee')
})

test('avatarUrl', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.avatarUrl).toBe('https://s3.amazonaws.com/anearassets/anon_user.png')
})

test('privateChannelName', () => {
  const p = new AnearParticipant(player1, MockEvent)
  expect(p.privateChannelName).toBe('anear:a:6i4GPGg7YiE81jxE65vpov:e:51nriTFWJYwiZRVfhaTmOM:private:4aih3BnWiRXLHKupFFkKHO')
})
