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

const MISSING_TIMEOUT = 10000 // msecs

const DeferredStates = [
  'RENDER_DISPLAY',
  'PARTICIPANT_EXIT',
  'PARTICIPANT_DISCONNECT',
  'PARTICIPANT_RECONNECT'
]

const AnearParticipantMachineContext = (anearParticipant, anearEvent, appParticipantMachineFactory) => ({
  anearEvent,
  anearParticipant,
  privateChannel: null,
  appParticipantMachineFactory,
  appParticipantMachine: null,
  noResponseTimeout: null,
  missingTimeout: MISSING_TIMEOUT,
  lastSeen: CurrentDateTimestamp()
})

const AnearParticipantMachineConfig = participantId => ({
  id: `AnearParticipantMachine_${participantId}`,
  initial: 'active',
  states: {
    active: {
      id: 'active',
      initial: 'setup',
      states: {
        setup: {
          id: 'setup',
          deferred: DeferredStates,
          initial: 'setupPrivateChannel',
          states: {
            setupPrivateChannel: {
              entry: ['createPrivateChannel'],
              invoke: {
                src: 'attachToPrivateChannel',
                onDone: {
                  target: '.',
                  internal: true
                },
                onError: {
                  target: '#error'
                }
              },
              on: {
                ATTACHED: {
                  actions: [
                    (context, event) => logger.debug(
                      "APM Got ATTACHED for privateChannel for ",
                      context.anearParticipant.id
                    ),
                    'sendParticipantReady'
                  ],
                  target: '#setupAppMachine'
                }
              }
            },
            setupAppMachine: {
              id: 'setupAppMachine',
              entry: 'createAnyAppParticipantMachine',
              always: '#live'
            },
          }
        },
        live: {
          id: 'live',
          entry: (c, e) => logger.debug(`Participant ${participantId} is LIVE!`),
          initial: 'idle',
          states: {
            idle: {
              id: 'idle',
              on: {
                RENDER_DISPLAY: {
                  target: '#renderDisplay'
                },
                PARTICIPANT_DISCONNECT: {
                  target: 'missing'
                },
                PARTICIPANT_EXIT: {
                  actions: (c, e) => logger.debug('APM got PARTICIPANT_EXIT.  Exiting...'),
                  target: '#cleanupAndExit'
                }
              }
            },
            missing: {
              entry: (c, e) => logger.info(`Participant ${c.anearParticipant.id} has disconnected`),
              on: {
                PARTICIPANT_EXIT: {
                  target: '#cleanupAndExit'
                },
                PARTICIPANT_RECONNECT: {
                  actions: (c, e) => logger.info(`Participant ${c.anearParticipant.id} has reconnected`),
                  target: '#live.idle'
                }
              }
            },
            renderDisplay: {
              id: 'renderDisplay',
              deferred: DeferredStates,
              invoke: {
                src: 'participantDisplay',
                onDone: [
                  {
                    cond: 'hasMetaTimeout',
                    actions: assign({noResponseTimeout: (context, event) => event.data.timeout.msecs}),
                    target: '#waitResponseWithTimeout'
                  },
                  {
                    target: '#live.idle',
                    internal: true
                  }
                ],
                onError: {
                  target: '#error'
                }
              }
            },
            waitResponseWithTimeout: {
              id: 'waitResponseWithTimeout',
              on: {
                ACTION: {
                  actions: ['updateLastSeen'],
                  target: '#live.idle'
                },
                after: {
                  timeoutMsecsAfterNoResponse: {
                    target: '#participantTimeout'
                  }
                }
              }
            },
            participantTimeout: {
              id: 'participantTimeout',
              entry: 'sendTimeoutEvents',
              target: 'idle'
            },
            cleanupAndExit: {
              id: 'cleanupAndExit',
              invoke: {
                src: 'detachPrivateChannel',
                onDone: {
                  actions: assign(() => {
                    privateChannel: null
                  }),
                  target: '#done'
                },
                onError: {
                  target: '#error'
                }
              }
            },
            done: {
              id: 'done',
              entry: ['notifyEventMachineExit'],
              type: 'final'
            }
          }
        }
      }
    },
    error: {
      id: 'error',
      entry: ['logErrorDetails', 'notifyEventMachineExit'],
      type: 'final'
    }
  }
})

const AnearParticipantMachineFunctions = {
  actions: {
    createPrivateChannel: assign((context, event) => {
      const privateChannel = RealtimeMessaging.getChannel(
        context.anearParticipant.privateChannelName,
        context.anearParticipant
      )

      return { privateChannel }
    }),
    sendParticipantReady: (context, event) => {
      context.anearEvent.send(
        'PARTICIPANT_MACHINE_READY',
        { data: { anearParticipant: context.anearParticipant } }
      )
    },
    createAnyAppParticipantMachine: assign({
      appParticipantMachine: context => {
        if (!context.appParticipantMachineFactory) return null

        const service = interpret(context.appParticipantMachineFactory(context.anearParticipant))
        service.subscribe(MetaViewPathParticipantProcessing)
        return service.start()
      }
    }),
    sendTimeoutEvents: context => {
      context.anearEvent.send('PARTICIPANT_TIMEOUT', { participantId: context.anearParticipant.id })
      if (context.appParticpantMachine) context.appParticipantMachine.send('PARTICIPANT_TIMEOUT')
    },
    updateLastSeen: assign({
      lastSeen: context => CurrentDateTimestamp()
    }),
    notifyEventMachineExit: (context, event) => {
      context.anearEvent.send('PARTICIPANT_MACHINE_EXIT', { participantId: context.anearParticipant.id })
    },
    logErrorDetails: (context, event) => {
      // Log the entire error object.
      if (event.data && event.data.stack) {
        logger.error("Stack trace:", event.data.stack);
      } else {
        logger.error("Error details:", event.data);
      }
    }
  },
  services: {
    participantDisplay: async (context, event) => {
      await RealtimeMessaging.publish(
        context.privateChannel,
        'PRIVATE_DISPLAY',
        event.content
      )
      return {timeout: event.timeout}
    },
    attachToPrivateChannel: (context, event) => RealtimeMessaging.attachTo(context.privateChannel),
    detachPrivateChannel: async (context, event) => {
      return context.privateChannel ? RealtimeMessaging.detachAll([context.privateChannel]) : Promise.resolve()
    }
  },
  guards: {
    hasAppParticipantMachine: context => context.appParticipantMachineFactory !== null,
    hasMetaTimeout: (context, event) => event.data.timeout?.msecs > 0
  },
  delays: {
    timeoutMsecsAfterNoResponse: context => context.noResponseTimeout
  }
}

// The AnearParticipantMachine:
//   1. maintains the presence and geo-location for a Participant in an Event
//   2. instantiates the XState Machine return by the (optional) appParticipantMachineFactory
//   3. creates a private display ChannelMachine to which any participant displayType messages get published
//   4. handles activity state, response timeouts, idle state
//   5. receives ACTION events relayed by the AnearEventMachine
//   6. relays all relevant events to the participant XState Machine for Application-specific handling
const AnearParticipantMachine = (anearParticipant, { anearEvent, appParticipantMachineFactory }) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearParticipantMachineConfig(anearParticipant.id)}

  const anearParticipantMachine = createMachine(expandedConfig, AnearParticipantMachineFunctions)

  const anearParticipantMachineContext = AnearParticipantMachineContext(
    anearParticipant,
    anearEvent,
    appParticipantMachineFactory
  )

  const service = interpret(anearParticipantMachine.withContext(anearParticipantMachineContext))

  anearParticipant.setMachine(service)

  service.subscribe(state => {
    logger.debug('─'.repeat(40))
    logger.debug(`APM EVENT → ${state.event.type}`)
    logger.debug(`APM NEXT STATE → ${JSON.stringify(state.value)}`)
  })

  return service
}

module.exports = AnearParticipantMachine
