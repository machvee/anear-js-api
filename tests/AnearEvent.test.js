"use strict"
const { assign } = require('xstate')
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')

const mockParticipantEnterHandler = jest.fn()
const mockParticipantRefreshHandler = jest.fn()
const mockParticipantExitHandler = jest.fn()
const mockParticipantActionHandler = jest.fn()

const TicTacToeMachineConfig = anearEvent => ({
  id: "testAnearEventStateMachine",
  initial: 'waitingForHost',
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
        PARTICIPANT_EXIT: {
          actions: 'participantExitHandler'
        }
      }
    },
    gameStart: {
      on: {
        BULLSEYE: {
          actions: 'actionHandler'
        },
        PARTICIPANT_EXIT: {
          actions: 'participantExitHandler'
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
      anearEvent.myParticipantEnterHandler(event.participant)
    },
    refreshHandler: (context, event) => {
      anearEvent.myParticipantRefreshHandler(event.participant)
    },
    participantExitHandler: (context, event) => {
      anearEvent.myParticipantExitHandler(event.participant)
    },
    actionHandler: assign({score: (context, event) => context.score + event.payload.points}),
  }
})

class TestEvent extends AnearEvent {
  initContext() {
    return {
      score: 90
    }
  }

  stateMachineConfig() {
    return TicTacToeMachineConfig(this)
  }

  stateMachineOptions() {
    return TicTacToeMachineOptions(this)
  }

  async myParticipantEnterHandler(...args) {
    return mockParticipantEnterHandler(...args)
  }
  async myParticipantExitHandler(...args) {
    return mockParticipantExitHandler(...args)
  }
  async myParticipantRefreshHandler(...args) {
    return mockParticipantRefreshHandler(...args)
  }
}


class TestEventWithDefaultXState extends AnearEvent {
  initContext() {
    return {
      playerScores: [83, 22]
    }
  }

  participantEnterEventCallback(participant) {
    mockParticipantEnterHandler(participant)
    return Promise.resolve()
  }

  participantRefreshEventCallback(participant) {
    mockParticipantRefreshHandler(participant)
    return Promise.resolve()
  }

  participantExitEventCallback(participant) {
    mockParticipantExitHandler(participant)
    return Promise.resolve()
  }

  participantActionEventCallback(participant, actionEventName, payload) {
    mockParticipantActionHandler(participant, actionEventName, payload)
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
  const t = new TestEvent(chatEvent, TestPlayer, MessagingStub)
  t.attributes.hosted = hosted
  t.startStateMachine()
  return t
}

const newTestEventWithDefaultXState = testEvent => {
  const t = new TestEventWithDefaultXState(testEvent, TestPlayer, MessagingStub)
  t.startStateMachine()
  return t
}

test('participant enter with Default Xstate Config', async () => {
  const t = newTestEventWithDefaultXState(chatEvent)

  const id = t.id
  expect(t.id).toBe(chatEvent.data.id)
  expect(t.relationships.user.data.type).toBe("users")
  expect(t.anearStateMachine.currentState.value).toBe("eventActive")
  expect(t.stateMachineContext.playerScores[0]).toBe(83)
  const p1 = new TestPlayer(chatParticipant1, t)

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
  const t = newTestEventWithDefaultXState(chatEvent)

  const p1 = new TestPlayer(chatParticipant1, t)

  await t.participantExit(p1)
  await t.update()

  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantExitHandler).toHaveBeenCalledTimes(1)
  expect(t.participants.numActive(false)).toBe(0)

  await t.remove()
})

test('participant refresh with Default Xstate Config', async () => {
  const t = newTestEventWithDefaultXState(chatEvent)
  const p1 = new TestPlayer(chatParticipant1, t)

  await t.refreshParticipant(p1)
  await t.update()

  expect(mockParticipantRefreshHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantRefreshHandler).toHaveBeenCalledTimes(1)
  await p1.remove()
  await t.remove()
})

test('participant action with Default Xstate Config', async () => {
  const t = newTestEventWithDefaultXState(chatEvent)
  const p1 = new TestPlayer(chatParticipant1, t)
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
  const p1 = new TestPlayer(chatParticipant1, t)
  const p2 = new TestPlayer(chatParticipant2, t)
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

  await t.participantExit(p1)
  await t.participantExit(p2)
  await t.update()
  await t.remove()

  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantExitHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive(false)).toBe(0)
})


test('can add participant, hosted', async () => {
  let t = newTestEvent(true)

  expect(t.hosted).toBe(true)
  expect(t.participants.numActive(false)).toBe(0)

  const host = new TestPlayer(chatHost, t)
  const p2 = new TestPlayer(chatParticipant2, t)
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

  await t.participantExit(host)
  await t.participantExit(p2)
  await t.update()
  await t.remove()

  expect(mockParticipantExitHandler).toHaveBeenCalledWith(host)
  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantExitHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive(false)).toBe(0)
})

test('can be retrieved back from storage with participants, not hosted', async () => {
  const testEvent = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1, testEvent)
  const p2 = new TestPlayer(chatParticipant2, testEvent)

  await testEvent.participantEnter(p1)
  await testEvent.participantEnter(p2)
  await testEvent.persist()

  const rehydratedTestEvent = await TestEvent.getFromStorage(testEvent.id, TestPlayer, MessagingStub)
  const rehydratedPlayer1 = await TestPlayer.getFromStorage(p1.id, rehydratedTestEvent)
  const rehydratedPlayer2 = await TestPlayer.getFromStorage(p2.id, rehydratedTestEvent)

  rehydratedTestEvent.startStateMachine()

  expect(rehydratedTestEvent.participants.numActive(false)).toBe(2)
  expect(rehydratedTestEvent.id).toBe(testEvent.id)
  expect(rehydratedTestEvent.relationships['user'].data.type).toBe("users")
  expect(rehydratedTestEvent.relationships['zone'].data.type).toBe("zones")
  expect(rehydratedTestEvent.participantTimeout).toBe(32000)
  expect(rehydratedTestEvent.stateMachineContext.score).toBe(90)
  expect(rehydratedTestEvent.included[0].relationships.app.data.id).toBe("5b9d9838-17de-4a80-8a64-744c222ba722")
  expect(rehydratedPlayer1.context.name).toBe('machvee')
  expect(rehydratedPlayer2.context.name).toBe('bbondfl93')

  await rehydratedTestEvent.participantExit(rehydratedPlayer1)
  await rehydratedTestEvent.participantExit(rehydratedPlayer2)
  await rehydratedTestEvent.remove()
})

test('can update state machine context via Action events', async () => {
  const t = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1, t)
  const p2 = new TestPlayer(chatParticipant2, t)

  await t.participantEnter(p1)
  await t.participantEnter(p2)
  await t.persist()

  const eventName = "BULLSEYE"
  const payload = {points: 1}

  await t.participantAction(p1, eventName, payload)
  await t.update()

  expect(t.anearStateMachine.context.score).toBe(91)

  await t.participantAction(p2, eventName, payload)
  await t.update()

  expect(t.anearStateMachine.context.score).toBe(92)

  await t.participantExit(p1)
  await t.participantExit(p2)
  await t.closeOutParticipants()
  await t.remove()
})

test('can reset All ParticipantTimers', async () => {
  const t = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1, t)
  const p2 = new TestPlayer(chatParticipant2, t)

  const resetMock = jest.spyOn(MessagingStub, "resetAllParticipantTimers");

  await t.participantEnter(p1)
  await t.participantEnter(p2)
  await t.persist()

  t.cancelParticipantTimers()

  expect(resetMock).toHaveBeenCalledTimes(1)

  await t.participantExit(p1)
  await t.participantExit(p2)
  await t.remove()
})
