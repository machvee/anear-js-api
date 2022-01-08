"use strict"
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')

const mockParticipantEnterHandler = jest.fn()
const mockParticipantRefreshHandler = jest.fn()
const mockParticipantCloseHandler = jest.fn()

class TestEvent extends AnearEvent {
  initAppData() {
    return {
      log: ["message1", "message2"],
    }
  }

  get xStateConfig() {
    return {
      id: "testAnearEventStateMachine",
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            JOIN: {
              actions: 'enterHandler'
            },
            REFRESH: {
              actions: 'refreshHandler'
            },
            CLOSE: {
              actions: 'closeHandler'
            }
          }
        }
      }
    }
  }

  get xStateOptions() {
    return {
      actions: {
        enterHandler: (context, event) => {
          mockParticipantEnterHandler(event.anearParticipant)
        },
        refreshHandler: (context, event) => {
          mockParticipantRefreshHandler(event.anearParticipant)
        },
        closeHandler: (context, event) => {
          mockParticipantCloseHandler(event.anearParticipant)
        }
      }
    }
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
        AnearParticipantFixture2: chatParticipant2,
        AnearHostFixture: chatHost } = require("./fixtures")

const MessagingStub = new MockMessaging()

afterAll(async () => await TestEvent.close())

afterEach(() => {jest.clearAllMocks()})

const newTestEvent = (hosted = false) => {
  const t = new TestEvent(chatEvent, MessagingStub)
  t.attributes.hosted = hosted
  return t
}

test('constructor', () => {
  const a = new TestEvent(chatEvent, MessagingStub)
  expect(a.id).toBe(chatEvent.data.id)
  expect(a.relationships.user.data.type).toBe("users")
})

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
  const id = t.id

  try {
    await t.participantEnter(p1)
    await t.persist()
    t = await TestEvent.getFromStorage(id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(p1.userType).toBe("participant")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p1)
  expect(t.participants.numActive(false)).toBe(1)
  expect(t.participants.host).toStrictEqual({})

  try {
    await t.participantEnter(p2)
    await t.update()
    //t = await TestEvent.getFromStorage(id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p2)
  expect(t.participants.numActive(false)).toBe(2)
  expect(t.participants.get(p2).name).toBe("bbondfl93")
  expect(p2.userType).toBe("participant")

  try {
    await t.participantClose(p1)
    await t.participantClose(p2)
    await t.update()
    //t = await TestEvent.getFromStorage(id, MessagingStub)
    await t.remove()
    await p1.remove()
    await p2.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantCloseHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive(false)).toBe(0)
})


test('can add participant, hosted', async () => {
  let t = newTestEvent(true)

  expect(t.hosted).toBe(true)
  expect(t.participants.numActive(false)).toBe(0)

  const host = new TestPlayer(chatHost)
  const p2 = new TestPlayer(chatParticipant2)
  const id = t.id

  try {
    await t.participantEnter(host)
    await t.persist()
    t = await TestEvent.getFromStorage(id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(host.userType).toBe("host")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(host)
  expect(t.participants.host.name).toBe('foxhole_host')
  expect(t.participants.numActive(false)).toBe(0) // event creator when hosted isn't active participant

  try {
    await t.participantEnter(p2)
    await t.update()
    t = await TestEvent.getFromStorage(id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p2)
  expect(t.participants.numActive(false)).toBe(1)
  expect(t.participants.get(p2).name).toBe('bbondfl93')

  try {
    await t.participantClose(host)
    await t.participantClose(p2)
    await t.update()
    t = await TestEvent.getFromStorage(id, MessagingStub)
    await t.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(host)
  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantCloseHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive(false)).toBe(0)
})

test('can be retrieved back from storage with participants, not hosted', async () => {
  const testEvent = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1)
  const p2 = new TestPlayer(chatParticipant2)

  try {
    await testEvent.participantEnter(p1)
    await testEvent.participantEnter(p2)

    await testEvent.persist()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  const rehydratedTestEvent = await TestEvent.getFromStorage(testEvent.id, MessagingStub)
  const rehydratedPlayer1 = await TestPlayer.getFromStorage(p1.id)
  const rehydratedPlayer2 = await TestPlayer.getFromStorage(p2.id)

  expect(rehydratedTestEvent.participants.numActive(false)).toBe(2)
  expect(rehydratedTestEvent.id).toBe(testEvent.id)
  expect(rehydratedTestEvent.relationships['user'].data.type).toBe("users")
  expect(rehydratedTestEvent.relationships['zone'].data.type).toBe("zones")
  expect(rehydratedTestEvent.participantTimeout).toBe(32000)
  expect(rehydratedTestEvent.included[0].relationships.app.data.id).toBe("5b9d9838-17de-4a80-8a64-744c222ba722")
  expect(rehydratedTestEvent.appData.log[1]).toBe('message2')
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
