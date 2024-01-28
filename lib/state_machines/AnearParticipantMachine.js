"use strict"

const { assign, createMachine, interpret } = require('xstate')

const ParticipantTimer = require('../utils/ParticipantTimer')

const TimeoutEventName = 'PARTICIPANT_TIMEOUT'
const UpdateContextEventName = 'UPDATE_CONTEXT'
const CurrentDateTimestamp = _ => new Date().getTime()

const PrivateDisplayMessagetType = 'PRIVATE_DISPLAY'

const AnearParticipantMachineContext = (anearParticipant, geoLocation, cssUrl, anearEvent, realtimeMessaging) => ({
  realtimeMessaging,
  anearEvent,
  anearParticipant,
  geoLocation,
  cssUrl,
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
      initial: 'sendCssUrl',
      on: {
        ATTACHED: {
          target: '#active.hist'
        },
        PRIVATE_DISPLAY: {
          target: '#privateDisplay'
        }
      },
      states: {
        sendCssUrl: {
          id: 'sendCssUrl',
          invoke: {
            src: 'sendCssUrlToParticipant',
            onDone: {
              target: 'waitLive'
            },
            onError: {
              target: '#error'
            }
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
                  actions: ['updateLastSeend'],
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
              entry: 'sendTimeoutToEvent',
              target: 'idle'
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
    idle: {
    },
    error: {
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
    sendTimeoutToEvent: context => context.anearEvent.anearEventMachine.send(TimeoutEventName),
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
      PrivateDisplayMessageType,
      event.displayMessage
    ),
    sendCssUrlToParticipant: context => context.realtimeMessaging.publish(
      context.privateChannel,
      CssUrlMessageType,
      context.cssUrl
    ),
  },
  guards: {
  }
}

// The AnearParticipantMachine:
//   1. maintains the presence and geo-location for a Participant in an Event
//   2. spawns the developer supplied ParticipantAppMachineClass
//   3. creates a private display ChannelMachine to which any private display messages get published
//   4. handles activity timer, response timeouts, idle state
//   5. receives ACTION events relayed by the AnearEventMachine
//   6. relays all relevant events to the ParticipantAppMachineClass for Application-specific handling
const AnearParticipantMachine = (anearParticipant, geoLocation, { anearEvent, cssUrl, realtimeMessaging }) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearParticipantMachineConfig(anearParticipant.id)}

  const participantMachine = createMachine(expandedConfig, AnearParticipantMachineFunctions)

  const anearParticipantMachineContext = AnearParticipantMachineContext(
    anearParticipant,
    geoLocation,
    cssUrl,
    anearEvent,
    realtimeMessaging
  )

  return interpret(participantMachine.withContext(anearParticipantMachineContext))
}

module.exports = AnearParticipantMachine
