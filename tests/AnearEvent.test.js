"use strict"
const { assign } = require('xstate')
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')

const mockParticipantEnterHandler = jest.fn()
const mockSpectatorViewHandler = jest.fn()
const mockParticipantRefreshHandler = jest.fn()
const mockParticipantExitHandler = jest.fn()
const mockParticipantActionHandler = jest.fn()

const TicTacToeMachineConfig = anearEvent => ({
  id: "testAnearEventStateMachine",
  initial: 'waitingForHost',
  states: {
    waitingForHost: {
      on: {
        PARTICIPANT_JOIN: {
          actions: 'enterHandler',
          target: 'waitingForOpponent'
        },
        SPECTATOR_VIEW: {
          actions: 'viewHandler',
          target: 'waitingForHost'
        }
      }
    },
    waitingForOpponent: {
      on: {
        PARTICIPANT_JOIN: {
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
        TEST_ACTION: {
          actions: 'testActionHandler'
        },
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
    viewHandler: (context, event) => {
      anearEvent.mySpectatorViewHandler(event.userId)
    },
    participantExitHandler: (context, event) => {
      anearEvent.myParticipantExitHandler(event.participant)
    },
    actionHandler: assign({score: (context, event) => context.score + event.payload.points}),
    testActionHandler: (context, event) => {
      anearEvent.myParticipantActionHandler(
        event.participant.id,
        event.type,
        event.payload
      )
    }
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

  async mySpectatorViewHandler(...args) {
    return mockSpectatorViewHandler(...args)
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
  async myParticipantActionHandler(...args) {
    return mockParticipantActionHandler(...args)
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

test('participant enter', async () => {
  const t = newTestEvent()

  const id = t.id
  expect(t.id).toBe(chatEvent.data.id)
  expect(t.relationships.user.data.type).toBe("users")
  expect(t.anearStateMachine.currentState.value).toBe("waitingForHost")
  expect(t.stateMachineContext.score).toBe(90)
  const p1 = new TestPlayer(chatParticipant1, t)

  await t.participantEnter(p1)
  expect(t.anearStateMachine.currentState.value).toBe("waitingForOpponent")
  await t.persist()
  await t.remove()

  expect(p1.userType).toBe("participant")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p1)
  expect(t.participants.numActive).toBe(1)

  await p1.remove()
})

test('spectator viewer', async () => {
  const t = newTestEvent()
  const userId = 999837834

  const id = t.id
  expect(t.anearStateMachine.currentState.value).toBe("waitingForHost")
  await t.spectatorView(userId)
  expect(t.anearStateMachine.currentState.value).toBe("waitingForHost")

  expect(mockSpectatorViewHandler).toHaveBeenCalledTimes(1)
  expect(mockSpectatorViewHandler).toHaveBeenCalledWith(userId)
})


test('participant close', async () => {
  const t = newTestEvent()

  const p1 = new TestPlayer(chatParticipant1, t)
  await t.participantEnter(p1)

  await t.participantExit(p1)
  await t.update()

  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantExitHandler).toHaveBeenCalledTimes(1)
  expect(t.participants.numActive).toBe(0)

  await t.remove()
})

test('participant action', async () => {
  const t = newTestEvent()
  const p1 = new TestPlayer(chatParticipant1, t)
  const p2 = new TestPlayer(chatParticipant2, t)
  await t.participantEnter(p1)
  await t.participantEnter(p2)

  const eventName = "TEST_ACTION"
  const payload = {x: 1, y: 99}

  await t.participantAction(p1, eventName, payload)
  await t.update()

  expect(mockParticipantActionHandler).toHaveBeenCalledWith(p1.id, eventName, payload)
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
  expect(t.participants.numActive).toBe(1)
  expect(t.participants.host).toBe(null)

  await t.participantEnter(p2)
  await t.update()

  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p2)
  expect(t.participants.numActive).toBe(2)
  expect(t.participants.get(p2).name).toBe("bbondfl93")
  expect(p2.userType).toBe("participant")

  await t.participantExit(p1)
  await t.participantExit(p2)
  await t.update()
  await t.remove()

  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p1)
  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantExitHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive).toBe(0)
})

test('purge all participants', async () => {
  let t = newTestEvent(true)
  const host = new TestPlayer(chatHost, t)
  const p1 = new TestPlayer(chatParticipant1, t)
  const p2 = new TestPlayer(chatParticipant2, t)
  await t.participantEnter(host)
  await t.participantEnter(p1)
  await t.participantEnter(p2)
  await t.update()

  expect(t.participants.host).toBe(host)
  expect(t.participants.ids).toStrictEqual([p1.id, p2.id])

  await t.purgeParticipants()

  expect(t.participants.all).toHaveLength(0)

  await t.remove()
})


test('can add participant, hosted', async () => {
  let t = newTestEvent(true)

  expect(t.hosted).toBe(true)
  expect(t.participants.numActive).toBe(0)

  const host = new TestPlayer(chatHost, t)
  const p2 = new TestPlayer(chatParticipant2, t)
  const id = t.id

  await t.participantEnter(host)
  await t.persist()

  expect(host.userType).toBe("host")
  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(1)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(host)
  expect(t.participants.host.name).toBe('foxhole_host')
  expect(t.participants.numActive).toBe(0) // event creator when hosted isn't active participant

  await t.participantEnter(p2)
  await t.update()

  expect(mockParticipantEnterHandler).toHaveBeenCalledTimes(2)
  expect(mockParticipantEnterHandler).toHaveBeenCalledWith(p2)
  expect(t.participants.numActive).toBe(1)
  expect(t.participants.get(p2).name).toBe('bbondfl93')

  await t.participantExit(host)
  await t.participantExit(p2)
  await t.update()
  await t.remove()

  expect(mockParticipantExitHandler).toHaveBeenCalledWith(host)
  expect(mockParticipantExitHandler).toHaveBeenCalledWith(p2)
  expect(mockParticipantExitHandler).toHaveBeenCalledTimes(2)
  expect(t.participants.numActive).toBe(0)
})

test('can be retrieved back from storage with participants, not hosted', async () => {
  const testEvent = newTestEvent(false)
  const p1 = new TestPlayer(chatParticipant1, testEvent)
  const p2 = new TestPlayer(chatParticipant2, testEvent)

  await testEvent.participantEnter(p1)
  await testEvent.participantEnter(p2)
  await testEvent.persist()

  const rehydratedTestEvent = await TestEvent.getFromStorage(testEvent.id, MessagingStub)

  rehydratedTestEvent.startStateMachine()

  await rehydratedTestEvent.participantEnter(p1)
  await rehydratedTestEvent.participantEnter(p2)

  expect(rehydratedTestEvent.participants.numActive).toBe(2)
  expect(rehydratedTestEvent.id).toBe(testEvent.id)
  expect(rehydratedTestEvent.relationships['user'].data.type).toBe("users")
  expect(rehydratedTestEvent.relationships['zone'].data.type).toBe("zones")
  expect(rehydratedTestEvent.participantTimeout).toBe(32000)
  expect(rehydratedTestEvent.stateMachineContext.score).toBe(90)
  expect(rehydratedTestEvent.included[0].relationships.app.data.id).toBe("5b9d9838-17de-4a80-8a64-744c222ba722")

  const rp1 = rehydratedTestEvent.participants.getById(p1.id)
  const rp2 = rehydratedTestEvent.participants.getById(p2.id)

  expect(rehydratedTestEvent.participants.getById(rp1.id).context.name).toBe('machvee')
  expect(rehydratedTestEvent.participants.getById(rp2.id).context.name).toBe('bbondfl93')

  await rehydratedTestEvent.participantExit(rp1)
  await rehydratedTestEvent.participantExit(rp2)
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
