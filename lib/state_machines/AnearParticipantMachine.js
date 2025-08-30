"use strict"

// A N E A R   P A R T I C I P A N T   M A C H I N E
//
//  Incoming Messages
//    - Response (ACTION) Messages routed from AnearEventMachine
//      - route to appParticipantMachine
//
//  Timeouts
//    1. PARTICIPANT_DISCONNECT.  Possibly a brief outage and will return.  Give them 60 seconds
//       to PARTICIPANT_RECONNECT otherwise cleanupAndExit
//    2. ACTION timeout (> 0 msecs)
//       - participants channel - group response timeout ... all participants should have responded
//         by this time.  The participants response is likely nullified, or could be fatal and the participant is terminated
//       - participant private channel - waiting for a players turn in a game. The App may decide to
//         nullify the participants turn and continue, or consider it fatal and end the event/participant is terminated
//    3. idle.  If participant doesn't voluntarily interact with the event with an ACTION, or a client update presence, the
//       participant may be deemed idle/missing and terminated.  This whe a client holds the game open in browser, but does
//       not interact.   This can be used to keep the game free of uninterested participants
const logger = require('../utils/Logger')
const { assign, createMachine, interpret } = require('xstate')
const C = require('../utils/Constants')

const RealtimeMessaging = require('../utils/RealtimeMessaging')

const CurrentDateTimestamp = _ => new Date().getTime()

const DeferredStates = [
  'ACTION',
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
  actionTimeoutMsecs: null,
  actionTimeoutStart: null,
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
                    'logAttached',
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
            }
          }
        },
        live: {
          id: 'live',
          entry: 'logLive',
          initial: 'idle',
          states: {
            idle: {
              on: {
                RENDER_DISPLAY: {
                  target: '#renderDisplay'
                },
                PRIVATE_DISPLAY: {
                  target: '#renderDisplay'
                },
                PARTICIPANT_DISCONNECT: {
                  target: 'waitReconnect'
                },
                PARTICIPANT_EXIT: {
                  actions: 'logExit',
                  target: '#cleanupAndExit'
                },
                PARTICIPANT_RECONNECT: {
                  actions: 'logReconnected',
                  internal: true
                }
              }
            },
            waitReconnect: {
              entry: 'logDisconnected',
              after: {
                dynamicReconnectTimeout: [
                  {
                    cond: 'wasMidTurnOnDisconnect',
                    actions: 'logActionTimeoutWhileDisconnected',
                    target: '#participantTimedOut'
                  },
                  {
                    actions: 'logNeverReconnected',
                    target: '#cleanupAndExit'
                  }
                ]
              },
              on: {
                PARTICIPANT_EXIT: {
                  target: '#cleanupAndExit'
                },
                PARTICIPANT_RECONNECT: [
                  {
                    cond: 'wasMidTurnOnDisconnect',
                    actions: 'logReconnected',
                    target: 'waitParticipantResponse'
                  },
                  {
                    actions: 'logReconnected',
                    target: 'idle'
                  }
                ]
              }
            },
            renderDisplay: {
              id: 'renderDisplay',
              deferred: DeferredStates,
              invoke: {
                src: 'publishPrivateDisplay',
                onDone: [
                  { cond: 'hasActionTimeout', actions: 'updateActionTimeout', target: 'waitParticipantResponse' },
                  { target: 'idle', internal: true }
                ],
                onError: {
                  target: '#error'
                }
              }
            },
            waitParticipantResponse: {
              always: {
                cond: 'isTimeoutImmediate',
                actions: 'logImmediateTimeout',
                target: '#participantTimedOut'
              },
              after: {
                actionTimeout: {
                  actions: 'nullActionTimeout',
                  target: '#participantTimedOut'
                }
              },
              on: {
                ACTION: {
                  actions: [
                    'updateLastSeen',
                    'sendActionToAppParticipantMachine',
                    'nullActionTimeout'
                  ],
                  target: 'idle'
                },
                PARTICIPANT_DISCONNECT: {
                  actions: 'updateRemainingTimeoutOnDisconnect',
                  target: 'waitReconnect'
                },
                PARTICIPANT_RECONNECT: {
                  actions: 'logReconnected',
                  internal: true
                }
              }
            },
            participantTimedOut: {
              id: 'participantTimedOut',
              entry: ['sendTimeoutEvents', 'nullActionTimeout'],
              always: 'idle'
            },
            cleanupAndExit: {
              id: 'cleanupAndExit',
              // Ignore most events during cleanup, but allow exit displays
              on: {
                RENDER_DISPLAY: { actions: 'logIgnoringRenderDisplayCleanup' },
                PRIVATE_DISPLAY: { actions: 'logIgnoringPrivateDisplayCleanup' },
                PARTICIPANT_EXIT: {
                  actions: 'logIgnoringRedundantExit'
                },
                PARTICIPANT_RECONNECT: {
                  actions: 'logIgnoringReconnectCleanup'
                },
                ACTION: {
                  actions: 'logIgnoringActionCleanup'
                }
              },
              invoke: {
                src: 'detachPrivateChannel',
                onDone: {
                  actions: assign(() => ({
                    privateChannel: null
                  })),
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
              // Final state - ignore all events except exit displays
              on: {
                RENDER_DISPLAY: { actions: 'logIgnoringRenderDisplayDone' },
                PRIVATE_DISPLAY: { actions: 'logIgnoringPrivateDisplayDone' },
                '*': {
                  actions: 'logIgnoringEventDone'
                }
              },
              type: 'final'
            }
          } // end live states
        } // end live
      } // end active states
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
        return service.start()
      }
    }),
    sendTimeoutEvents: context => {
      context.anearEvent.send('PARTICIPANT_TIMEOUT', { participantId: context.anearParticipant.id })
      if (context.appParticipantMachine) context.appParticipantMachine.send('PARTICIPANT_TIMEOUT')
    },
    sendActionToAppParticipantMachine: (context, event) => {
      if (context.appParticipantMachine) context.appParticipantMachine.send(event)
    },
    updateLastSeen: assign({
      lastSeen: context => CurrentDateTimestamp()
    }),
    updateActionTimeout: assign((context, event) => {
      const newTimeoutDuration = event.data.timeout

      if (context.actionTimeoutStart) {
        const elapsed = CurrentDateTimestamp() - context.actionTimeoutStart
        const remaining = newTimeoutDuration - elapsed
        logger.debug(`[APM] Resuming timer for ${context.anearParticipant.id} with ${remaining}ms remaining`)
        return {
          actionTimeoutMsecs: remaining > 0 ? remaining : 0
        }
      } else {
        logger.debug(`[APM] Starting new timer for ${context.anearParticipant.id} with ${newTimeoutDuration}ms`)
        return {
          actionTimeoutMsecs: newTimeoutDuration,
          actionTimeoutStart: CurrentDateTimestamp()
        }
      }
    }),
    nullActionTimeout: assign({
      actionTimeoutMsecs: _c => null,
      actionTimeoutStart: _c => null
    }),
    updateRemainingTimeoutOnDisconnect: assign((context, event) => {
      if (context.actionTimeoutStart) {
        const elapsed = CurrentDateTimestamp() - context.actionTimeoutStart
        const remaining = context.actionTimeoutMsecs - elapsed
        const remainingMsecs = remaining > 0 ? remaining : 0
        logger.debug(`[APM] Participant disconnected mid-turn. Storing remaining timeout of ${remainingMsecs}ms`)
        return {
          actionTimeoutMsecs: remainingMsecs
        }
      }
      return {}
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
    },
    logAttached: (c, e) => logger.debug(`[APM] Got ATTACHED for privateChannel for ${c.anearParticipant.id}`),
    logLive: (c, e) => logger.debug(`[APM] Participant ${c.anearParticipant.id} is LIVE!`),
    logExit: (c, e) => logger.debug('[APM] got PARTICIPANT_EXIT. Exiting...'),
    logDisconnected: (c, e) => logger.info(`[APM] Participant ${c.anearParticipant.id} has DISCONNECTED`),
    logActionTimeoutWhileDisconnected: c => logger.info(`[APM] Participant ${c.anearParticipant.id} timed out on action while disconnected.`),
    logNeverReconnected: c => logger.info(`[APM] Participant ${c.anearParticipant.id} never RECONNECTED. Exiting.`),
    logReconnected: (c, e) => logger.info(`[APM] Participant ${c.anearParticipant.id} has RECONNECTED`),
    logImmediateTimeout: (c, e) => logger.debug(`[APM] Timeout of ${c.actionTimeoutMsecs}ms is immediate for ${c.anearParticipant.id}.`),
    logIgnoringRenderDisplayCleanup: (c, e) => logger.debug('[APM] ignoring RENDER_DISPLAY during cleanup'),
    logIgnoringPrivateDisplayCleanup: (c, e) => logger.debug('[APM] ignoring PRIVATE_DISPLAY during cleanup'),
    logIgnoringRedundantExit: () => logger.debug('[APM] ignoring redundant PARTICIPIPANT_EXIT during cleanup'),
    logIgnoringReconnectCleanup: () => logger.debug('[APM] ignoring PARTICIPANT_RECONNECT during cleanup - already timed out'),
    logIgnoringActionCleanup: () => logger.debug('[APM] ignoring ACTION during cleanup'),
    logIgnoringRenderDisplayDone: () => logger.debug('[APM] ignoring RENDER_DISPLAY in final state'),
    logIgnoringPrivateDisplayDone: () => logger.debug('[APM] ignoring PRIVATE_DISPLAY in final state'),
    logIgnoringEventDone: (_c, e) => logger.debug('[APM] ignoring event in final state: ', e.type)
  },
  services: {
    publishPrivateDisplay: async (context, event) => {
      const displayMessage = { content: event.content }

      await RealtimeMessaging.publish(
        context.privateChannel,
        'PRIVATE_DISPLAY',
        displayMessage
      )

      return { timeout: event.timeout }
    },
    attachToPrivateChannel: (context, event) => RealtimeMessaging.attachTo(context.privateChannel),
    detachPrivateChannel: async (context, event) => {
      return context.privateChannel ? RealtimeMessaging.detachAll([context.privateChannel]) : Promise.resolve()
    }
  },
  guards: {
    hasAppParticipantMachine: context => context.appParticipantMachineFactory !== null,
    hasActionTimeout: (_c, event) => event.data && event.data.timeout > 0,
    isTimeoutImmediate: context => context.actionTimeoutMsecs !== null && context.actionTimeoutMsecs <= 0,
    wasMidTurnOnDisconnect: context => context.actionTimeoutMsecs !== null && context.actionTimeoutMsecs > 0
  },
  delays: {
    actionTimeout: context => context.actionTimeoutMsecs,
    dynamicReconnectTimeout: context => {
      // If an action timeout is active, use its remaining time.
      if (context.actionTimeoutMsecs !== null && context.actionTimeoutMsecs > 0) {
        logger.debug(`[APM] Using remaining action timeout for reconnect window: ${context.actionTimeoutMsecs}ms`)
        return context.actionTimeoutMsecs
      }
      // Otherwise, use the standard reconnect timeout.
      logger.debug(`[APM] Using standard reconnect timeout: ${C.TIMEOUT_MSECS.RECONNECT}ms`)
      return C.TIMEOUT_MSECS.RECONNECT
    }
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
