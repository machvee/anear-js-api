"use strict"
const { assign } = require('xstate')
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')

const mockParticipantEnterHandler = jest.fn()
const mockParticipantRefreshHandler = jest.fn()
const mockParticipantCloseHandler = jest.fn()
const mockParticipantActionHandler = jest.fn()

const TicTacToeMachineConfig = anearEvent => ({
  id: "testAnearEventStateMachine",
  initial: 'waitingForHost',
  context: {
    score: 0
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
        BULLSEYE: {
          actions: 'actionHandler'
        },
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
      anearEvent.myParticipantEnterHandler(event.anearParticipant)
    },
    refreshHandler: (context, event) => {
      anearEvent.myParticipantRefreshHandler(event.anearParticipant)
    },
    closeHandler: (context, event) => {
      anearEvent.myParticipantCloseHandler(event.anearParticipant)
    },
    actionHandler: assign({score: (context, event) => context.score + event.payload.points})
  }
})

class TestEvent extends AnearEvent {
  stateMachineConfig(previousState) {
    return TicTacToeMachineConfig(this)
  }

  stateMachineOptions() {
    return TicTacToeMachineOptions(this)
  }

  async myParticipantEnterHandler(...args) {
    return mockParticipantEnterHandler(...args)
  }
  async myParticipantCloseHandler(...args) {
    return mockParticipantCloseHandler(...args)
  }
  async myParticipantRefreshHandler(...args) {
    return mockParticipantRefreshHandler(...args)
  }
}

const defaultContext = {
  playerScores: [83, 22]
}

class TestEventWithDefaultXState extends AnearEvent {
  initContext() {
    return defaultContext
  }

  participantEnterEventCallback(anearParticipant) {
    mockParticipantEnterHandler(anearParticipant)
    return Promise.resolve()
  }

  participantRefreshEventCallback(anearParticipant) {
    mockParticipantRefreshHandler(anearParticipant)
    return Promise.resolve()
  }

  participantCloseEventCallback(anearParticipant) {
    mockParticipantCloseHandler(anearParticipant)
    return Promise.resolve()
  }

  participantActionEventCallback(anearParticipant, actionEventName, payload) {
    mockParticipantActionHandler(anearParticipant, actionEventName, payload)
    return Promise.resolve()
  }
}

class TestPlayer extends AnearParticipant {
  initContext() {
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

test('participant enter with Default Xstate Config', async () => {
  const t = new TestEventWithDefaultXState(chatEvent, MessagingStub)
  const id = t.id
  expect(t.id).toBe(chatEvent.data.id)
  expect(t.relationships.user.data.type).toBe("users")
  expect(t.anearStateMachine.currentState.value).toBe("eventActive")
  const p1 = new TestPlayer(chatParticipant1)

  await t.participantEnter(p1)
  await t.persist()
  await t.remove()

  expect(p1.userType).toBe("participant")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p1)
  expect(t.participants.numActive(false)).toBe(1)
  await p1.remove()
})

test('participant close with Default Xstate Config', async () => {
  const t = new TestEventWithDefaultXState(chatEvent, MessagingStub)
  const p1 = new TestPlayer(chatParticipant1)

  await t.participantClose(p1)
  await t.update()

  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantCloseHandler).toHaveBeenCalledTimes(1)
  expect(t.participants.numActive(false)).toBe(0)

  await t.remove()
})

test('participant refresh with Default Xstate Config', async () => {
  const t = new TestEventWithDefaultXState(chatEvent, MessagingStub)
  const p1 = new TestPlayer(chatParticipant1)

  await t.refreshParticipant(p1)
  await t.update()

  expect(mockParticipantRefreshHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantRefreshHandler).toHaveBeenCalledTimes(1)
  await p1.remove()
  await t.remove()
})

test('participant action with Default Xstate Config', async () => {
  const t = new TestEventWithDefaultXState(chatEvent, MessagingStub)
  const p1 = new TestPlayer(chatParticipant1)
  const eventName = "TEST_ACTION"
  const payload = {x: 1, y: 99}

  await t.participantAction(p1, eventName, payload)
  await t.update()

  expect(mockParticipantActionHandler).toHaveBeenCalledWith(p1, eventName, payload)
  expect(mockParticipantActionHandler).toHaveBeenCalledTimes(1)
  await p1.remove()
  await t.remove()
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

  await t.participantEnter(p1)
  await t.persist()

  expect(p1.userType).toBe("participant")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p1)
  expect(t.participants.numActive(false)).toBe(1)
  expect(t.participants.host).toStrictEqual({})

  await t.participantEnter(p2)
  await t.update()

  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p2)
  expect(t.participants.numActive(false)).toBe(2)
  expect(t.participants.get(p2).name).toBe("bbondfl93")
  expect(p2.userType).toBe("participant")

  await t.participantClose(p1)
  await t.participantClose(p2)
  await t.update()
  await t.remove()

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

  await t.participantEnter(host)
  await t.persist()

  expect(host.userType).toBe("host")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(host)
  expect(t.participants.host.name).toBe('foxhole_host')
  expect(t.participants.numActive(false)).toBe(0) // event creator when hosted isn't active participant

  await t.participantEnter(p2)
  await t.update()

  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p2)
  expect(t.participants.numActive(false)).toBe(1)
  expect(t.participants.get(p2).name).toBe('bbondfl93')

  await t.participantClose(host)
  await t.participantClose(p2)
  await t.update()
  await t.remove()

  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(host)
  expect(mockParticipantCloseHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantCloseHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive(false)).toBe(0)
})

test('can be retrieved back from storage with participants, not hosted', async () => {
  const testEvent = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1)
  const p2 = new TestPlayer(chatParticipant2)

  await testEvent.participantEnter(p1)
  await testEvent.participantEnter(p2)
  await testEvent.persist()

  const rehydratedTestEvent = await TestEvent.getFromStorage(testEvent.id, MessagingStub)
  const rehydratedPlayer1 = await TestPlayer.getFromStorage(p1.id)
  const rehydratedPlayer2 = await TestPlayer.getFromStorage(p2.id)

  expect(rehydratedTestEvent.participants.numActive(false)).toBe(2)
  expect(rehydratedTestEvent.id).toBe(testEvent.id)
  expect(rehydratedTestEvent.relationships['user'].data.type).toBe("users")
  expect(rehydratedTestEvent.relationships['zone'].data.type).toBe("zones")
  expect(rehydratedTestEvent.participantTimeout).toBe(32000)
  expect(rehydratedTestEvent.included[0].relationships.app.data.id).toBe("5b9d9838-17de-4a80-8a64-744c222ba722")
  expect(rehydratedPlayer1.context.name).toBe('machvee')
  expect(rehydratedPlayer2.context.name).toBe('bbondfl93')

  await rehydratedTestEvent.participantClose(rehydratedPlayer1)
  await rehydratedTestEvent.participantClose(rehydratedPlayer2)
  await rehydratedTestEvent.remove()
})

test('can update state machine context via Action events', async () => {
  const t = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1)
  const p2 = new TestPlayer(chatParticipant2)

  await t.participantEnter(p1)
  await t.participantEnter(p2)
  await t.persist()

  const eventName = "BULLSEYE"
  const payload = {points: 1}

  await t.participantAction(p1, eventName, payload)
  await t.update()

  expect(t.anearStateMachine.context.score).toBe(1)

  await t.participantAction(p2, eventName, payload)
  await t.update()

  expect(t.anearStateMachine.context.score).toBe(2)

  await t.participantClose(p1)
  await t.participantClose(p2)
  await t.remove()
})
