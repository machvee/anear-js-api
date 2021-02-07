"use strict"
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')

const mockParticipantEnterCallback = jest.fn()
const mockParticipantRefreshCallback = jest.fn()
const mockParticipantCloseCallback = jest.fn()

class TestEvent extends AnearEvent {
  initAppData() {
    return {
      log: ["message1", "message2"],
      state: 'live'
    }
  }

  async participantEnterEventCallback(anearParticipant) {
    mockParticipantEnterCallback(anearParticipant)
  }

  async participantRefreshEventCallback(anearParticipant) {
    mockParticipantRefreshCallback(anearParticipant)
  }

  async participantCloseEventCallback(anearParticipant) {
    mockParticipantCloseCallback(anearParticipant)
  }
}

class TestPlayer extends AnearParticipant {
  initAppData() {
    return {
      name: this.name,
      age: 26,
    }
  }
}

const { AnearEventFixture: chatEvent,
        AnearParticipantFixture1: chatParticipant1,
        AnearParticipantFixture2: chatParticipant2 } = require("./fixtures")

const MessagingStub = new MockMessaging()

const identity = (p, anearEvent) => (
  {...p.identity, isHost: p.identity.userId === anearEvent.userId && anearEvent.attributes.hosted }
)

afterAll(async () => await TestEvent.close())

afterEach(() => {jest.clearAllMocks()})

test('constructor', () => {
  const a = new TestEvent(chatEvent, MessagingStub)
  expect(a.id).toBe(chatEvent.data.id)
  expect(a.relationships.user.data.type).toBe("users")
})

const newTestEvent = (hosted = false) => {
  const t = new TestEvent(chatEvent, MessagingStub)
  t.attributes.hosted = hosted
  return t
}

test('can be persisted and removed repeatedly in storage', async () => {
  const t = newTestEvent()
  await t.persist()
  await t.remove()
  const again = newTestEvent()
  await again.persist()
  await again.remove()
})

test('can add participants, not hosted', async () => {
  let t = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1)
  const p2 = new TestPlayer(chatParticipant2)

  try {
    await t.participantEnter(p1, identity(p1, t))
    await t.persist()
    t = await TestEvent.getFromStorage(t.data.id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantEnterCallback).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterCallback).toHaveBeenCalledWith(p1)
  expect(t.numActiveParticipants()).toBe(1)
  expect(t.getEventParticipant(p1).name).toBe('machvee')

  try {
    await t.participantEnter(p2, identity(p2, t))
    await t.update()
    t = await TestEvent.getFromStorage(t.data.id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantEnterCallback).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterCallback).toHaveBeenCalledWith(p2)
  expect(t.numActiveParticipants()).toBe(2)
  expect(t.getEventParticipant(p2).name).toBe('bbondfl93')

  try {
    await t.participantClose(p1)
    await t.participantClose(p2)
    await t.update()
    t = await TestEvent.getFromStorage(t.data.id, MessagingStub)
    await t.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantCloseCallback).toHaveBeenCalledWith(p1)
  expect(mockParticipantCloseCallback).toHaveBeenCalledWith(p2)
  expect(mockParticipantCloseCallback).toHaveBeenCalledTimes(2)
  expect(t.numActiveParticipants()).toBe(0)
})


test('can add participant, hosted', async () => {
  let t = newTestEvent(true)

  const p1 = new TestPlayer(chatParticipant1)
  const p2 = new TestPlayer(chatParticipant2)

  try {
    await t.participantEnter(p1, identity(p1, t))
    await t.persist()
    t = await TestEvent.getFromStorage(t.data.id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantEnterCallback).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterCallback).toHaveBeenCalledWith(p1)
  expect(t.getEventParticipant(p1).name).toBe('machvee')
  expect(t.numActiveParticipants()).toBe(0) // event creator when hosted isn't active participant

  try {
    await t.participantEnter(p2, identity(p2, t))
    await t.update()
    t = await TestEvent.getFromStorage(t.data.id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantEnterCallback).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterCallback).toHaveBeenCalledWith(p2)
  expect(t.numActiveParticipants()).toBe(1)
  expect(t.getEventParticipant(p2).name).toBe('bbondfl93')

  try {
    await t.participantClose(p1)
    await t.participantClose(p2)
    await t.update()
    t = await TestEvent.getFromStorage(t.data.id, MessagingStub)
    await t.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantCloseCallback).toHaveBeenCalledWith(p1)
  expect(mockParticipantCloseCallback).toHaveBeenCalledWith(p2)
  expect(mockParticipantCloseCallback).toHaveBeenCalledTimes(2)
  expect(t.numActiveParticipants()).toBe(0)
})

test('can be retrieved back from storage with participants, not hosted', async () => {
  const testEvent = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1)
  const p2 = new TestPlayer(chatParticipant2)

  try {
    await testEvent.participantEnter(p1, identity(p1, testEvent))
    await testEvent.participantEnter(p2, identity(p2, testEvent))

    await testEvent.persist()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  const rehydratedTestEvent = await TestEvent.getFromStorage(testEvent.data.id, MessagingStub)
  const rehydratedPlayer1 = await TestPlayer.getFromStorage(p1.id)
  const rehydratedPlayer2 = await TestPlayer.getFromStorage(p2.id)

  expect(rehydratedTestEvent.numActiveParticipants()).toBe(2)
  expect(rehydratedTestEvent.id).toBe(testEvent.data.id)
  expect(rehydratedTestEvent.relationships['user'].data.type).toBe("users")
  expect(rehydratedTestEvent.relationships['zone'].data.type).toBe("zones")
  expect(rehydratedTestEvent.participantTimeout).toBe(32000)
  expect(rehydratedTestEvent.included[0].relationships.app.data.id).toBe("5b9d9838-17de-4a80-8a64-744c222ba722")
  expect(rehydratedTestEvent.appData.log[1]).toBe('message2')
  expect(rehydratedTestEvent.appData.state).toBe('live')
  expect(rehydratedPlayer1.appData.name).toBe('machvee')
  expect(rehydratedPlayer2.appData.name).toBe('bbondfl93')

  try {
    await rehydratedTestEvent.participantClose(rehydratedPlayer1)
    await rehydratedTestEvent.participantClose(rehydratedPlayer2)
    await rehydratedTestEvent.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }
})

test('can be retrieved back from storage with lock, not hosted', async () => {
  try {
    const testEvent = newTestEvent(false)
    await testEvent.persist()
    const anEvent = await TestEvent.getWithLockFromStorage(
      testEvent.data.id,
      async rehydratedTestEvent => {
        expect(rehydratedTestEvent.id).toBe(testEvent.data.id)
        expect(rehydratedTestEvent.relationships['user'].data.type).toBe("users")
        expect(rehydratedTestEvent.relationships['zone'].data.type).toBe("zones")
        expect(rehydratedTestEvent.participantTimeout).toBe(32000)
        expect(rehydratedTestEvent.included[0].relationships.app.data.id).toBe("5b9d9838-17de-4a80-8a64-744c222ba722")
        expect(rehydratedTestEvent.appData.log[0]).toBe('message1')
        expect(rehydratedTestEvent.appData.state).toBe('live')
        rehydratedTestEvent.appData.state = 'closed'
        await rehydratedTestEvent.update()
      },
      MessagingStub
    )
    expect(anEvent.appData.log[0]).toBe('message1')
    await testEvent.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }
})
