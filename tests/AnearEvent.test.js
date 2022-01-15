"use strict"
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')

const mockParticipantEnterHandler = jest.fn()
const mockParticipantRefreshHandler = jest.fn()
const mockParticipantCloseHandler = jest.fn()
const score = 42

const TicTacToeMachineConfig = anearEvent => ({
  id: "testAnearEventStateMachine",
  initial: 'waitingForHost',
  context: {
    score: score
  },
  states: {
    waitingForHost: {
      on: {
        JOIN: {
          actions: 'enterHandler',
          target: 'waitingForOpponent'
        }
      }
    },
    waitingForOpponent: {
      on: {
        JOIN: {
          actions: 'enterHandler',
          target: 'gameStart'
        },
        REFRESH: {
          actions: 'refreshHandler'
        },
        CLOSE: {
          actions: 'closeHandler'
        }
      }
    },
    gameStart: {
      on: {
        CLOSE: {
          actions: 'closeHandler'
        },
        REFRESH: {
          actions: 'refreshHandler'
        }
      }
    }
  }
})

const TicTacToeMachineOptions = anearEvent => ({
  actions: {
    enterHandler: (context, event) => {
      anearEvent.myParticipantEnterHandler(context.score, event.anearParticipant)
    },
    refreshHandler: (context, event) => {
      anearEvent.myParticipantRefreshHandler(event.anearParticipant)
    },
    closeHandler: (context, event) => {
      anearEvent.myParticipantCloseHandler(event.anearParticipant)
    }
  }
})

class TestEvent extends AnearEvent {
  initAppData() {
    return {
      log: ["message1", "message2"],
    }
  }

  stateMachineConfig() {
    return TicTacToeMachineConfig(this)
  }

  stateMachineOptions() {
    return TicTacToeMachineOptions(this)
  }

  myParticipantEnterHandler(...args) {
    mockParticipantEnterHandler(...args)
  }
  myParticipantCloseHandler(...args) {
    mockParticipantCloseHandler(...args)
  }
  myParticipantRefreshHandler(...args) {
    mockParticipantRefreshHandler(...args)
  }
}

const defaultContext = {
  scores: [83, 22]
}

class TestEventWithDefaultXState extends AnearEvent {
  initAppData() {
    return defaultContext
  }

  async participantEnterEventCallback(anearParticipant) {
    mockParticipantEnterHandler(anearParticipant)
  }

  async participantRefreshEventCallback(anearParticipant) {
    mockParticipantRefreshHandler(anearParticipant)
  }

  async participantCloseEventCallback(anearParticipant) {
    mockParticipantCloseHandler(anearParticipant)
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

test('constructor with Default Xstate Config', async () => {
  let t = new TestEventWithDefaultXState(chatEvent, MessagingStub)
  const id = t.id
  expect(t.id).toBe(chatEvent.data.id)
  expect(t.relationships.user.data.type).toBe("users")
  const p1 = new TestPlayer(chatParticipant1)

  try {
    await t.participantEnter(p1)
    await t.persist()
    t = await TestEventWithDefaultXState.getFromStorage(id, MessagingStub)
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(p1.userType).toBe("participant")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p1)
  expect(t.participants.numActive(false)).toBe(1)

  try {
    await t.participantClose(p1)
    await t.update()
    //t = await TestEvent.getFromStorage(id, MessagingStub)
    await t.remove()
    await p1.remove()
  } catch(err) {
    throw new Error(`test failed: ${err}`)
  }

  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantCloseHandler).toHaveBeenCalledTimes(1)
  expect(t.participants.numActive(false)).toBe(0)
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
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(score, p1)
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
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(score, p2)
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
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(score, host)
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
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(score, p2)
  expect(t.participants.numActive(false)).toBe(1)
  expect(t.participants.get(p2).name).toBe('bbondfl93')

  try {
    await t.participantClose(host)
    await t.participantClose(p2)
    await t.update()
    t = await TestEvent.getFromStorage(id, MessagingStub)
    await t.remove()
    await host.remove()
    await p2.remove()
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
