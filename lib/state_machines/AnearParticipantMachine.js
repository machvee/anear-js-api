"use strict"

// A N E A R   P A R T I C I P A N T   M A C H I N E
//
//  Incoming Messages
//    - Action Messages routed from AnearEventMachine
//      - route to appParticipantMachine
//
//  Action Timeout
//    - route to anearEventMachine
//      - route to appEventMachine
//    - route to appParticipantMachine

const { assign, createMachine, interpret } = require('xstate')
const constants = require('../utils/Constants')

const MetaViewPathParticipantProcessing = require('../utils/MetaViewPathParticipantProcessing')

const CurrentDateTimestamp = _ => new Date().getTime()

const AnearParticipantMachineContext = (anearParticipant, geoLocation, anearEvent, realtimeMessaging, appParticipantMachineFactory) => ({
  realtimeMessaging,
  anearEvent,
  anearParticipant,
  geoLocation,
  appParticipantMachineFactory,
  appParticipantMachine: null,
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
        PRIVATE_DISPLAY: {
          target: '#privateDisplay'
        }
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
              on: {
                ACTION_WITH_TIMEOUT: 'waitActionWithTimeout',
                ACTION: 'waitAction'
              }
            },
            waitActionWithTimeout: {
              on: {
                ACTION: {
                  actions: ['updateLastSeen'],
                  target: 'idle'
                },
                after: {
                  timeoutMsecsAfterNoAction: {
                    target: 'participantTimeout'
                  }
                }
              }
            },
            participantTimeout: {
              entry: 'sendTimeoutEvents',
              target: 'idle'
            },
            waitAction: {
              on: {
                ACTION: {
                  actions: ['updateLastSeen'],
                  target: 'idle'
                }
              }
            }
          }
        },
        privateDisplay: {
          id: 'privateDisplay',
          invoke: {
            src: 'privateParticipantDisplay',
            onDone: {
              target: '#active.hist'
            },
            onError: {
              target: '#error'
            }
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
        privateChannel: context => context.realtimeMessaging.getChannel(
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
      context.anearEvent.anearEventMachine.send(constants.TimeoutEventName, { participantId: context.anearParticipant.id })
      if (context.appParticpantMachine) context.appParticipantMachine.send(constants.TimeoutEventName)
    },
    updateLastSeen: assign(
      {
        lastSeen: context => CurrentDateTimestamp()
      }
    )
  },
  delays: {
    timeoutMsecsAfterNoAction: (context, event) => context.anearEvent.participantTimeout
  },
  services: {
    privateParticipantDisplay: (context, event) => context.realtimeMessaging.publish(
      context.privateChannel,
      constants.PrivateDisplayEventName,
      event.content
    )
  },
  guards: {
    hasAppParticipantMachine: context => context.appParticipantMachineFactory !== null
  }
}

// The AnearParticipantMachine:
//   1. maintains the presence and geo-location for a Participant in an Event
//   2. instantiates the XState Machine return by the (optional) appParticipantMachineFactory
//   3. creates a private display ChannelMachine to which any private display messages get published
//   4. handles activity timer, response timeouts, idle state
//   5. receives ACTION events relayed by the AnearEventMachine
//   6. relays all relevant events to the participant XState Machine for Application-specific handling
const AnearParticipantMachine = (anearParticipant, geoLocation, { anearEvent, realtimeMessaging, appParticipantMachineFactory }) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearParticipantMachineConfig(anearParticipant.id)}

  const anearParticipantMachine = createMachine(expandedConfig, AnearParticipantMachineFunctions)

  const anearParticipantMachineContext = AnearParticipantMachineContext(
    anearParticipant,
    geoLocation,
    anearEvent,
    realtimeMessaging,
    appParticipantMachineFactory
  )

  return interpret(anearParticipantMachine.withContext(anearParticipantMachineContext))
}

module.exports = AnearParticipantMachine
