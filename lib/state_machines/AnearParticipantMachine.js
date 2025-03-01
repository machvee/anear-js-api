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
  privateChannel: null
})

const AnearParticipantMachineConfig = participantId => ({
  id: `AnearParticipantMachine_${participantId}`,
  initial: 'createPrivateChannel',
  states: {
    createPrivateChannel: {
      entry: 'createPrivateChannel',
      always: {
        target: 'active'
      }
    },
    active: {
      id: 'active',
      initial: 'createParticipantMachine',
      on: {
        ATTACHED: {
          target: '#active.hist'
        },
      },
      states: {
        createParticipantMachine: {
          always: [
            {
              cond: 'hasAppParticipantMachine',
              target: 'createAppParticipantMachine'
            },
            {
              target: 'waitLive'
            }
          ],
          onError: {
            target: '#error'
          }
        },
        createAppParticipantMachine: {
          id: 'createAppParticipantMachine',
          entry: 'createAppParticipantMachine',
          always: {
            target: 'waitLive'
          }
        },
        waitLive: {
          on: {
            START: 'live'
          }
        },
        live: {
          id: 'live',
          initial: 'idle',
          states: {
            idle: {
              PRIVATE_DISPLAY: {
                target: 'privateDisplay'
              }
            },
            privateDisplay: {
              id: 'privateDisplay',
              invoke: {
                src: 'privateParticipantDisplay',
                onDone: [
                  {
                    cond: 'hasMetaTimeout',
                    actions: assign({noResponseTimeout: (context, event) => event.data.timer.msecs}),
                    target: 'waitResponseWithTimeout'
                  },
                  {
                    target: 'waitResponse'
                  }
                ],
                onError: {
                  target: '#error'
                }
              }
            },
            waitResponse: {
              on: {
                ACTION: {
                  actions: ['updateLastSeen'],
                  target: 'idle'
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
        },
        hist: {
          // used to transition back to child state
          type: 'history',
          history: 'deep'
        }
      }
    },
    error: {
      id: 'error',
      type: 'final'
    }
  }
})

const AnearParticipantMachineFunctions = {
  actions: {
    createPrivateChannel: assign(
      {
        privateChannel: context => RealtimeMessaging.getChannel(
          context.anearParticipant.privateChannelName,
          context.anearParticipant.anearParticipantMachine
        )
      }
    ),
    createAppParticipantMachine: assign(
      {
        appParticipantMachine: context => {
          const interpretedService = interpret(context.appParticipantMachineFactory(context.anearParticipant))
          const service = interpretedService.onTransition(MetaViewPathParticipantProcessing)
          return service.start()
        }
      }
    ),
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
      return event.timer
    }
  },
  guards: {
    hasAppParticipantMachine: context => context.appParticipantMachineFactory !== null,
    hasMetaTimeout: (context, event) => !!event.data.timer
  },
  delays: {
    timeoutMsecsAfterNoResponse: (context, event) => context.noResponseTimeout
  }
}

// The AnearParticipantMachine:
//   1. maintains the presence and geo-location for a Participant in an Event
//   2. instantiates the XState Machine return by the (optional) appParticipantMachineFactory
//   3. creates a private display ChannelMachine to which any private display messages get published
//   4. handles activity timer, response timeouts, idle state
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
