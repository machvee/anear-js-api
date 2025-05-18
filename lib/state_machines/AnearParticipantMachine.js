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
const { assign, createMachine, interpret, sendParent } = require('xstate')
const C = require('../utils/Constants')

const MetaViewPathParticipantProcessing = require('../utils/MetaViewPathParticipantProcessing')
const RealtimeMessaging = require('../utils/RealtimeMessaging')

const CurrentDateTimestamp = _ => new Date().getTime()

const MISSING_TIMEOUT = 10000 // msecs

const AnearParticipantMachineContext = (anearParticipant, geoLocation, anearEvent, appParticipantMachineFactory) => ({
  anearEvent,
  anearParticipant,
  geoLocation,
  appParticipantMachineFactory,
  appParticipantMachine: null,
  noResponseTimeout: null,
  missingTimeout: MISSING_TIMEOUT,
  lastSeen: CurrentDateTimestamp(),
  privateChannel: null
})

const AnearParticipantMachineConfig = participantId => ({
  id: `AnearParticipantMachine_${participantId}`,
  initial: 'setupPrivateChannel',
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
              on: {
                PRIVATE_DISPLAY: {
                  target: 'privateDisplay'
                },
                PARTICIPANT_DISCONNECT: {
                  target: 'missing'
                },
                PARTICIPANT_EXIT: {
                  target: 'done'
                },
              }
            },
            missing: {
              entry: (c, e) => logger.info(`Participant ${c.anearParticipant.id} has disconnected`),
              on: {
                PARTICIPANT_EXIT: {
                  target: 'done'
                },
                PARTICIPANT_RECONNECT: {
                  actions: (c, e) => logger.info(`Participant ${c.anearParticipant.id} has reconnected`),
                  target: '#live'
                }
              }
            },
            privateDisplay: {
              id: 'privateDisplay',
              deferred: ['PARTICIPANT_EXIT', 'PRIVATE_DISPLAY'],
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
            done: {
              id: 'done',
              actions: (c, e) => logger.info(`participant ${context.anearParticipant.id} exited`),
              // need to message the anearEventMachine that this participant is done/gone
              type: 'final'
            }
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
            context.anearParticipant
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
    sendTimeoutEvents: context => {
      sendParent('PARTICIPANT_TIMEOUT', { participantId: context.anearParticipant.id })
      if (context.appParticpantMachine) context.appParticipantMachine.send('PARTICIPANT_TIMEOUT')
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
        'PRIVATE_DISPLAY',
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
