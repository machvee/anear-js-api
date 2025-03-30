"use strict"

// A N E A R   P A R T I C I P A N T   M A C H I N E
//
//  Incoming Messages
//    - Response (ACTION) Messages routed from AnearEventMachine
//      - route to appParticipantMachine
//
//  No Response Timeout
//    - route to anearEventMachine
//      - route to appEventMachine
//    - route to appParticipantMachine
const logger = require('../utils/Logger')
const { assign, createMachine, interpret } = require('xstate')
const C = require('../utils/Constants')

const MetaViewPathParticipantProcessing = require('../utils/MetaViewPathParticipantProcessing')
const RealtimeMessaging = require('../utils/RealtimeMessaging')

const CurrentDateTimestamp = _ => new Date().getTime()

const AnearParticipantMachineContext = (anearParticipant, geoLocation, anearEvent, appParticipantMachineFactory) => ({
  anearEvent,
  anearParticipant,
  geoLocation,
  appParticipantMachineFactory,
  appParticipantMachine: null,
  noResponseTimeout: null,
  lastSeen: CurrentDateTimestamp(),
  privateChannel: null,
  displayQueue: []
})

const GlobalEventConfig = {
  PRIVATE_DISPLAY: {
    // the MetaProcessor will send this events when responding to meta: display: in the appStateMachine config
    actions: ['queuePrivateDisplayEvents'],
    target: '.',
    internal: true
  }
}

const AnearParticipantMachineConfig = participantId => ({
  id: `AnearParticipantMachine_${participantId}`,
  initial: 'setupPrivateChannel',
  on: GlobalEventConfig,
  states: {
    setupPrivateChannel: {
      entry: ['createPrivateChannel'],
      always: 'active'
    },
    active: {
      id: 'active',
      initial: 'setupAppMachine',
      states: {
        setupAppMachine: {
          entry: 'createAnyAppParticipantMachine',
          always: 'live'
        },
        live: {
          id: 'live',
          initial: 'idle',
          states: {
            idle: {
              entry: ['flushPrivateDisplayQueue'],
              on: {
                PRIVATE_DISPLAY: {
                  target: 'privateDisplay'
                }
              }
            },
            privateDisplay: {
              id: 'privateDisplay',
              invoke: {
                src: 'privateParticipantDisplay',
                onDone: [
                  {
                    cond: 'hasMetaTimeout',
                    actions: assign({noResponseTimeout: (context, event) => event.data.timeout.msecs}),
                    target: 'waitResponseWithTimeout'
                  },
                  {
                    target: 'idle'
                  }
                ],
                onError: {
                  target: '#error'
                }
              }
            },
            waitResponseWithTimeout: {
              on: {
                ACTION: {
                  actions: ['updateLastSeen'],
                  target: 'idle'
                },
                after: {
                  timeoutMsecsAfterNoResponse: {
                    target: 'participantTimeout'
                  }
                }
              }
            },
            participantTimeout: {
              entry: 'sendTimeoutEvents',
              target: 'idle'
            },
          }
        }
      }
    },
    error: {
      id: 'error',
      entry: (context, event) => {
        // Log the entire error object.
        if (event.data && event.data.stack) {
          logger.error("Stack trace:", event.data.stack);
        } else {
          logger.error("Error details:", event.data);
        }
      },
      type: 'final'
    }
  }
})

const AnearParticipantMachineFunctions = {
  actions: {
    createPrivateChannel: assign(
      {
        privateChannel: context => {
          return RealtimeMessaging.getChannel(
            context.anearParticipant.privateChannelName,
            context.anearParticipant.machineRef
          )
        }
      }
    ),
    createAnyAppParticipantMachine: assign(
      {
        appParticipantMachine: context => {
          if (context.appParticipantMachineFactory) {
            const interpretedService = interpret(context.appParticipantMachineFactory(context.anearParticipant))
            const service = interpretedService.onTransition(MetaViewPathParticipantProcessing)
            return service.start()
          } else {
            return null
          }
        }
      }
    ),
    queuePrivateDisplayEvents: assign({
      displayQueue: (context, event) => {
        return [...context.displayQueue, {content: event.content, timeout: event.timeout}]
      }
    }),
    flushPrivateDisplayQueue: assign({
      displayQueue: (context, event) => {
        if (context.displayQueue.length > 0) {
          context.displayQueue.forEach(
            displayEvent => context.anearParticipant.machineRef.send(C.PrivateDisplayEventName, displayEvent)
          )
        }
        return []
      }
    }),
    sendTimeoutEvents: context => {
      context.anearEvent.anearEventMachine.send(C.TimeoutEventName, { participantId: context.anearParticipant.id })
      if (context.appParticpantMachine) context.appParticipantMachine.send(C.TimeoutEventName)
    },
    updateLastSeen: assign(
      {
        lastSeen: context => CurrentDateTimestamp()
      }
    )
  },
  services: {
    privateParticipantDisplay: async (context, event) => {
      await RealtimeMessaging.publish(
        context.privateChannel,
        C.PrivateDisplayEventName,
        event.content
      )
      return {timeout: event.timeout}
    }
  },
  guards: {
    hasAppParticipantMachine: context => context.appParticipantMachineFactory !== null,
    hasMetaTimeout: (context, event) => event.data.timeout.msecs > 0
  },
  delays: {
    timeoutMsecsAfterNoResponse: context => context.noResponseTimeout
  }
}

// The AnearParticipantMachine:
//   1. maintains the presence and geo-location for a Participant in an Event
//   2. instantiates the XState Machine return by the (optional) appParticipantMachineFactory
//   3. creates a private display ChannelMachine to which any private display messages get published
//   4. handles activity state, response timeouts, idle state
//   5. receives ACTION events relayed by the AnearEventMachine
//   6. relays all relevant events to the participant XState Machine for Application-specific handling
const AnearParticipantMachine = (anearParticipant, geoLocation, { anearEvent, appParticipantMachineFactory }) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearParticipantMachineConfig(anearParticipant.id)}

  const anearParticipantMachine = createMachine(expandedConfig, AnearParticipantMachineFunctions)

  const anearParticipantMachineContext = AnearParticipantMachineContext(
    anearParticipant,
    geoLocation,
    anearEvent,
    appParticipantMachineFactory
  )

  return interpret(anearParticipantMachine.withContext(anearParticipantMachineContext))
}

module.exports = AnearParticipantMachine
