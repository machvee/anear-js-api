"use strict"
const logger = require('../utils/Logger')

//
// A N E A R   E V E N T   M A C H I N E
//  Incoming Messages
//    - Event Messages
//      - route to appEventMachine
//    - Participant Enter / Leave Presence Messages
//      - route to appEventMachine
//    - Participant Leave Presence
//      - participant intentionally/accidentally exited event via UI or client code
//    - Participant Actions
//      - route to appEventMachine
//      - route to participants[participantId].machine
//        - route to appParticipantMachine
//  Participant Action Timeout
//    - route to appEventMachine
//
//  Outgoing Messages
//    - All Participants Display
//    - All Spectators Display
//    - Public (Merchant Location) Display
//

const { assign, createMachine, interpret } = require('xstate')
const C = require('../utils/Constants')

const getPlayingParticipantIds = (context) => {
  return Object.keys(context.participants).filter(id => !context.participants[id].isHost);
};

const getAllParticipantIds = (context) => {
  return Object.keys(context.participants);
};

const RealtimeMessaging = require('../utils/RealtimeMessaging')
const AppMachineTransition = require('../utils/AppMachineTransition')
const DisplayEventProcessor = require('../utils/DisplayEventProcessor')
const PugHelpers = require('../utils/PugHelpers')

const AnearApi = require('../api/AnearApi')
const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')
const AnearParticipant = require('../models/AnearParticipant')

const CurrentDateTimestamp = _ => new Date().getTime()

const AnearEventMachineContext = (
  anearEvent,
  coreServiceMachine,
  pugTemplates,
  pugHelpers,
  appEventMachineFactory,
  appParticipantMachineFactory
) => ({
  anearEvent,
  coreServiceMachine,
  pugTemplates,
  pugHelpers,
  appEventMachineFactory,
  appParticipantMachineFactory,
  appEventMachine: null,
  eventChannel: null,               // event control messages
  actionsChannel: null,             // participant presence/live actions
  participantsDisplayChannel: null, // display all participants
  spectatorsDisplayChannel: null,    // display all spectators
  participants: {},
  participantMachines: {},
  participantsActionTimeout: null
})

const DeferredStates = [
  'PARTICIPANT_ENTER',
  'PARTICIPANT_LEAVE',
  'SPECTATOR_ENTER',
  'PARTICIPANT_TIMEOUT',
  'ACTION',
  'CANCEL',
  'CLOSE'
]

const DeferredStatesPlus = (...additionalStates) => DeferredStates.concat(additionalStates)

const ActiveEventGlobalEvents = {
  PARTICIPANT_MACHINE_EXIT: {
    // the AnearParticipantMachine has hit its final state
    actions: ['cleanupExitingParticipant']
  },
  CLOSE: {
    // AppM has reached a final state or explicitly called closeEvent()
    // initiate orderly shutdown
    target: '#activeEvent.closeEvent'
  },
  CANCEL: {
    // appM does an abrupt shutdown of the event
    target: '#canceled'
  }
}

const ActiveEventStatesConfig = {
  id: 'activeEvent',
  initial: 'registerCreator',
  states: {
    registerCreator: {
      // Obtaining the creator presence is open to race conditions in Ably, so
      // First, while continuing to defer any PARTICIPANT_ENTERs, see if the creator presence
      // is available via channel.get() and if not, we will get the PARTICIPANT_ENTER at the
      // right time in waiting where the deferred is not active.
      initial: 'loading',
      states: {
        loading: {
          deferred: DeferredStates,
          invoke: {
            src: 'getAttachedCreatorOrHost',
            onDone: {
              // event.data.anearParticipant will be null if no presence enter
              // was available on actions channel via get().  We must wait for
              // the undeferred PARTICIPANT_ENTER instead.  But if get() DID
              // return the creator presence, then an APM will be created
              // and we goto waiting for the PARTICIPANT_MACHINE_READY
              actions: ['startNewParticipantMachine'],
              target: 'waiting'
            },
            onError: {
              target: '#failure'
            }
          }
        },
        waiting: {
          id: 'waiting',
          initial: 'creatorStatus',
          states: {
            creatorStatus: {
              id: 'creatorStatus',
              on: {
                PARTICIPANT_ENTER: {
                  actions: 'logCreatorEnter',
                  target: '#waiting.fetching'
                },
                PARTICIPANT_MACHINE_READY: {
                  actions: ['logAPMReady', 'sendEnterToAppMachine'],
                  target: '#eventCreated'
                }
              }
            },
            fetching: {
              id: 'fetching',
              deferred: DeferredStates,
              invoke: {
                src: 'fetchParticipantData',
                onDone: {
                  // event.data.anearParticipant available in actions
                  actions: ['startNewParticipantMachine'],
                  target: '#waiting.creatorStatus'
                },
                onError: {
                  target: '#activeEvent.failure'
                }
              }
            }
          }
        }
      }
    },
    // eventCreated is the start state for the event, and both the
    // event creator/first-participant or host/emcee arrive here.
    // The first-participant probably wants to transition to
    // announce right away to allow opponents/team-members to
    // join via QR code scan.  The host likely wants to do some
    // app-specific setup which could take some time, and transition to announce
    // only when the game/event is properly setup or the right time
    // has arrived.  The appEventMachine is responsible for firing the
    // ANNOUNCE or START event at the appropriate time e.g. a quorum is
    // reached, host setup is complete, and/or its 8pm ... time to start
    eventCreated: {
      id: 'eventCreated',
      initial: 'waitingAnnounce',
      entry: [
        'enableSpectatorPresenceEvents'
      ],
      on: {
        ACTION: {
          actions: ['processParticipantAction']
        },
        RENDER_DISPLAY: {
          target: '#createdRendering'
        },
        PARTICIPANT_LEAVE: [
          {
            cond: 'isHostLeaving',
            actions: ['sendHostExitToAppMachine', 'sendExitToParticipantMachine']
          },
          {
            cond: 'isPermanentLeave',
            actions: ['sendExitToAppMachine', 'sendExitToParticipantMachine']
          },
          {
            actions: ['processDisconnectEvents']
          }
        ],
        PARTICIPANT_ENTER: [
          {
            cond: 'participantExists',
            actions: 'processReconnectEvents'
          },
          {
            // This shouldn't happen in eventCreated, but good to handle.
            target: '#newParticipantJoining'
          }
        ]
      },
      states: {
        waitingAnnounce: {
          id: 'waitingAnnounce',
          after: {
            timeoutEventAnnounce: {
              actions: context => logger.info(`[AEM] Event ${context.anearEvent.id} TIMED OUT waiting for ANNOUNCE`),
              target: '#canceled'
            }
          },
          on: {
            ANNOUNCE: {
              target: '#activeEvent.announce'
            },
            START: {
              target: '#activeEvent.live'
            }
          }
        },
        createdRendering: {
          id: 'createdRendering',
          deferred: DeferredStatesPlus('ANNOUNCE', 'START'),
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: 'notifyingRenderComplete',
              internal: true
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        notifyingRenderComplete: {
          after: {
            timeoutRendered: {
              target: '#waitingAnnounce'
            }
          }
        }
      }
    },
    announce: {
      // during the announce state, spectators can scan the event QR
      // code and are taken to the event landing page where they can click
      // JOIN and trigger a PARTICIPANT_ENTER or just continue to spectate for the
      // event's entirety.  Browser Refresh can also trigger a PARTICIPANT_ENTER for an
      // existing participant
      initial: 'transitioning',
      on: {
        ACTION: {
          actions: ['processParticipantAction']
        },
        RENDER_DISPLAY: {
          target: '#announceRendering'
        },
        PARTICIPANT_LEAVE: [
          {
            cond: 'isHostLeaving',
            actions: ['sendHostExitToAppMachine', 'sendExitToParticipantMachine']
          },
          {
            cond: 'isPermanentLeave',
            actions: ['sendExitToAppMachine', 'sendExitToParticipantMachine']
          },
          {
            actions: ['processDisconnectEvents']
          }
        ],
        PARTICIPANT_ENTER: [
          {
            // a participant could re-entering the event after above PARTICIPANT_LEAVE (browser refresh).
            // so look for existing participants and send reconnect events to interested machines
            cond: 'participantExists',
            actions: 'processReconnectEvents'
          },
          {
            // spectator clicked JOIN
            target: '#newParticipantJoining'
          }
        ],
        SPECTATOR_ENTER: {
          actions: 'sendSpectatorEnterToAppEventMachine'
        }
      },
      states: {
        transitioning: {
          deferred: DeferredStatesPlus('START'),
          invoke: {
            // there may be some ably channel attach race conditions
            // which would have spectators already attached to the spectators
            // display channel, and we get their presence via a GET
            src: 'transitionAndGetAttachedSpectators',
            onDone: {
              actions: ['sendSpectatorEnterToAppEventMachine'],
              target: '#waitingToStart'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waitingToStart: {
          id: 'waitingToStart',
          entry: () => logger.debug("[AEM] announce state...waiting for event START"),
          after: {
            timeoutEventStart: {
              actions: context => logger.info(`[AEM] Event ${context.anearEvent.id} TIMED OUT waiting for START`),
              target: '#canceled'
            }
          },
          on: {
            START: {
              target: '#activeEvent.live'
            }
          }
        },
        announceRendering: {
          id: 'announceRendering',
          deferred: DeferredStatesPlus('START'),
          invoke: {
            src: 'renderDisplay',
            onDone: [
              {
                cond: 'isParticipantsTimeoutActive',
                target: 'notifyingRenderCompleteWithTimeout',
                actions: 'setupParticipantsTimeout'
              },
              {
                target: 'notifyingRenderComplete',
                internal: true
              }
            ],
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        newParticipantJoining: {
          // a PARTICIPANT_ENTER received from a new user JOIN click. create an AnearParticipantMachine instance.
          // This machine tracks presence, geo-location (when approved by mobile participant),
          // manages active/idle state for long-running events, and manages any ACTION timeouts.
          id: 'newParticipantJoining',
          deferred: DeferredStatesPlus('START'),
          invoke: {
            src: 'fetchParticipantData',
            onDone: {
              actions: ['startNewParticipantMachine'],
              target: '#waitParticipantReady'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        notifyingRenderComplete: {
          after: {
            timeoutRendered: {
              target: '#waitingToStart',
              actions: ['notifyAppMachineRendered']
            }
          }
        },
        notifyingRenderCompleteWithTimeout: {
          after: {
            timeoutRendered: {
              target: 'waitAllParticipantsResponse',
              actions: ['notifyAppMachineRendered']
            }
          }
        },
        waitAllParticipantsResponse: {
          always: {
            cond: 'allParticipantsResponded',
            target: 'waitingToStart',
            actions: ['clearParticipantsTimeout']
          },
          after: {
            participantsActionTimeout: {
              target: 'handleParticipantsTimeout'
            }
          },
          on: {
            ACTION: {
              actions: ['processAndForwardAction', 'processParticipantResponse'],
              internal: true
            },
            PARTICIPANT_LEAVE: [
              {
                cond: 'isHostLeaving',
                actions: ['removeLeavingParticipantFromTimeout', 'sendHostExitToAppMachine', 'sendExitToParticipantMachine']
              },
              {
                cond: 'isPermanentLeave',
                actions: ['removeLeavingParticipantFromTimeout', 'sendExitToAppMachine', 'sendExitToParticipantMachine']
              },
              {
                actions: ['processDisconnectEvents']
              }
            ]
          }
        },
        handleParticipantsTimeout: {
          entry: ['sendActionsTimeoutToAppM', 'clearParticipantsTimeout'],
          always: 'waitingToStart'
        },
        waitParticipantReady: {
          id: 'waitParticipantReady',
          deferred: DeferredStatesPlus('START'),
          on: {
            PARTICIPANT_MACHINE_READY: {
              actions: ['sendEnterToAppMachine'],
              target: '#waitingToStart',
              internal: true
            }
          }
        }
      }
    },
    live: {
      id: 'live',
      initial: 'transitioning',
      on: {
        RENDER_DISPLAY: {
          target: '.liveRendering'
        },
        PARTICIPANT_LEAVE: [
          {
            cond: 'isHostLeaving',
            actions: ['sendHostExitToAppMachine', 'sendExitToParticipantMachine']
          },
          {
            cond: 'isPermanentLeave',
            actions: ['sendExitToAppMachine', 'sendExitToParticipantMachine']
          },
          {
            actions: ['processDisconnectEvents']
          }
        ],
        PARTICIPANT_ENTER: [
          {
            cond: 'participantExists',
            actions: 'processReconnectEvents'
          },
          {
            // spectator clicked JOIN
            target: '.participantEntering'
          }
        ],
        PAUSE: {
          target: 'paused'
        }
      },
      states: {
        transitioning: {
          deferred: DeferredStates,
          invoke: {
            src: 'transitionToLive',
            onDone: {
              target: 'waitingForActions'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waitingForActions: {
          id: 'waitingForActions',
          entry: () => logger.debug('[AEM] live state...waiting for actions'),
          on: {
            ACTION: {
              actions: ['processParticipantAction']
            }
          }
        },
        liveRendering: {
          id: 'liveRendering',
          deferred: DeferredStates,
          invoke: {
            src: 'renderDisplay',
            onDone: [
              {
                cond: 'isParticipantsTimeoutActive',
                target: 'notifyingRenderCompleteWithTimeout',
                actions: 'setupParticipantsTimeout'
              },
              {
                target: 'notifyingRenderComplete',
                internal: true
              }
            ],
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        notifyingRenderComplete: {
          after: {
            timeoutRendered: {
              target: 'waitingForActions',
              actions: ['notifyAppMachineRendered']
            }
          }
        },
        notifyingRenderCompleteWithTimeout: {
          after: {
            timeoutRendered: {
              target: 'waitAllParticipantsResponse',
              actions: ['notifyAppMachineRendered']
            }
          }
        },
        waitAllParticipantsResponse: {
          always: {
            cond: 'allParticipantsResponded',
            target: 'waitingForActions',
            actions: ['clearParticipantsTimeout']
          },
          after: {
            participantsActionTimeout: {
              target: 'handleParticipantsTimeout'
            }
          },
          on: {
            ACTION: {
              actions: ['processAndForwardAction', 'processParticipantResponse'],
              internal: true
            },
            PARTICIPANT_LEAVE: [
              {
                cond: 'isHostLeaving',
                actions: ['removeLeavingParticipantFromTimeout', 'sendHostExitToAppMachine', 'sendExitToParticipantMachine']
              },
              {
                cond: 'isPermanentLeave',
                actions: ['removeLeavingParticipantFromTimeout', 'sendExitToAppMachine', 'sendExitToParticipantMachine']
              },
              {
                actions: ['processDisconnectEvents']
              }
            ]
          }
        },
        handleParticipantsTimeout: {
          entry: ['sendActionsTimeoutToAppM', 'clearParticipantsTimeout'],
          always: 'waitingForActions'
        },
        participantEntering: {
          // a PARTICIPANT_ENTER received from a new user JOIN click. Unless already exists,
          // create an AnearParticipantMachine instance.
          // This machine tracks presence, geo-location (when approved by mobile participant),
          // manages active/idle state for long-running events, and manages any ACTION timeouts.
          id: 'participantEntering',
          deferred: DeferredStates,
          invoke: {
            src: 'fetchParticipantData',
            onDone: {
              actions: ['startNewParticipantMachine'],
              target: '#waitParticipantJoined',
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waitParticipantJoined: {
          id: 'waitParticipantJoined',
          deferred: DeferredStates,
          on: {
            PARTICIPANT_MACHINE_READY: {
              actions: ['sendEnterToAppMachine'],
              target: 'waitingForActions',
              internal: true
            }
          }
        }
      }
    },
    paused: {
      initial: 'transitioning',
      states: {
        transitioning: {
          deferred: DeferredStatesPlus('RESUME', 'CLOSE'),
          invoke: {
            src: 'transitionToPaused',
            onDone: {
              target: 'waitingForResume'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waitingForResume: {
          on: {
            RESUME: '#activeEvent.live',
            CLOSE: '#activeEvent.closeEvent'
          }
        }
      }
    },
    closeEvent: {
      id: 'closeEvent',
      initial: 'notifyingParticipants',
      states: {
        notifyingParticipants: {
          entry: 'sendParticipantExitEvents',
          always: 'waitForParticipantsToExit'
        },
        waitForParticipantsToExit: {
          entry: context => logger.debug(`[AEM] Entering waitForParticipantsToExit with ${getAllParticipantIds(context).length} participants`),
          always: [
            {
              cond: context => getAllParticipantIds(context).length === 0,
              target: 'finalizing'
            }
          ],
          on: {
            PARTICIPANT_LEAVE: {
              actions: () => logger.debug('[AEM] Ignoring PARTICIPANT_LEAVE during orchestrated shutdown.')
            }
          }
        },
        finalizing: {
          deferred: DeferredStates,
          invoke: {
            src: 'eventTransitionClosed',
            onDone: 'detaching',
            onError: '#activeEvent.failure'
          }
        },
        detaching: {
          deferred: DeferredStates,
          invoke: {
            src: 'detachChannels',
            onDone: {
              target: '#activeEvent.doneExit'
            }
          }
        }
      }
    },
    canceled: {
      id: 'canceled',
      initial: 'notifyingParticipants',
      on: {
        CLOSE: {
          actions: () => logger.debug('[AEM] Ignoring CLOSE during cancel.')
        }
      },
      states: {
        notifyingParticipants: {
          entry: 'sendParticipantExitEvents',
          always: 'waitForParticipantsToExit'
        },
        waitForParticipantsToExit: {
          entry: context => logger.debug(`[AEM] Entering waitForParticipantsToExit with ${getAllParticipantIds(context).length} participants`),
          always: [
            {
              cond: context => getAllParticipantIds(context).length === 0,
              target: 'finalizing'
            }
          ],
          on: {
            PARTICIPANT_LEAVE: {
              actions: () => logger.debug('[AEM] Ignoring PARTICIPANT_LEAVE during orchestrated shutdown.')
            }
          }
        },
        finalizing: {
          deferred: DeferredStates,
          invoke: {
            src: 'eventTransitionCanceled',
            onDone: 'detaching',
            onError: '#activeEvent.failure'
          }
        },
        detaching: {
          deferred: DeferredStates,
          invoke: {
            src: 'detachChannels',
            onDone: {
              target: '#activeEvent.doneExit'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        }
      }
    },
    review: {
      on: {
        NEXT: 'reward'
      }
    },
    reward: {
      on: {
        NEXT: 'archived'
      }
    },
    archived: {
      always: {
        target: 'doneExit'
      }
    },
    doneExit: {
      id: 'doneExit',
      entry: 'notifyCoreServiceMachineExit',
      type: 'final'
    },
    failure: {
      id: 'failure',
      entry: (context, event) => {
        // Log the entire error object.
        if (event.data && event.data.stack) {
          logger.error("[AEM] Stack trace:", event.data.stack);
        } else {
          logger.error("[AEM] Error details:", event.data);
        }
      },
      always: {
        // TODO: How can we cleanup here... terminate participant machines,
        // and signal to AnearCoreService Machine to free up resource.need to fi
        target: 'doneExit'
      }
    }
  }
}

const CreateEventChannelsAndAppMachineConfig = {
  // Creates all Ably channels needed at the start of the
  // event prior to its transitioning to announce and live.
  // 1. create events channel and subscribe to its messages, then transition upon ATTACHED
  // 2. create participants display channel, attach to it, and transition upon ATTACHED
  // 3. create actions channel and subscribe to its messages, then transition upon ATTACHED
  // 4. If the event supports spectators, cerate the specatators channel, attach to it,
  //    then transition upon ATTACHED
  // 5. Create Event App Machine
  // 6. Transition to activeEvent
  id: 'createChannels',
  initial: 'setupEventChannel',
  deferred: DeferredStates, // don't allow PARTICIPANT_ENTER until we are registering creator/host

  states: {
    setupEventChannel: {
      // get(eventChannelName) and setup state-change callbacks
      entry: [(c,e) => logger.debug(`[AEM] === NEW EVENT ${c.anearEvent.id} ===`), 'createEventChannel'],
      invoke: {
        src: 'attachToEventChannel',
        onDone: {
          target: '.',
          internal: true
        },
        onError: {
          target: "#activeEvent.failure"
        }
      },
      on: {
        ATTACHED: {
          actions: ['subscribeToEventMessages'],
          target: 'setupParticipantsDisplayChannel'
        }
      }
    },
    setupParticipantsDisplayChannel: {
      entry: 'createParticipantsDisplayChannel',
      invoke: {
        src: 'attachToParticipantsDisplayChannel',
        onDone: {
          target: 'setupParticipantsDisplayChannel',
          internal: true
        },
        onError: {
          target: '#activeEvent.failure'
        }
      },
      on: {
        ATTACHED: {
          target: 'setupActionsChannel'
        }
      }
    },
    setupActionsChannel: {
      entry: 'createActionsChannel',
      invoke: {
        src: 'attachToActionsChannel',
        onDone: {
          target: '.',
          internal: true
        },
        onError: {
          target: '#activeEvent.failure'
        }
      },
      on: {
        ATTACHED: {
          actions: ['enableParticipantPresenceEvents', 'subscribeToActionMessages'],
          target: 'setupSpectatorsChannel'
        }
      }
    },
    setupSpectatorsChannel: {
      entry: 'createSpectatorsChannel',
      invoke: {
        src: 'attachToSpectatorsChannel',
        onDone: {
          target: 'setupSpectatorsChannel',
          internal: true
        },
        onError: {
          target: '#activeEvent.failure'
        }
      },
      on: {
        ATTACHED: {
          target: 'createAppEventMachine' // spectatorsDisplayChannel ATTACHED
        }
      }
    },
    createAppEventMachine: {
      entry: ['createAppEventMachine'],
      always: {
        target: '#activeEvent'
      }
    }
  }
}

const AnearEventMachineStatesConfig = eventId => ({
  //
  // ANEAR EVENT MACHINE STATES
  //
  id: `anearEventMachine_${eventId}`,
  initial: 'createEventChannels',

  on: ActiveEventGlobalEvents,
  states: {
    createEventChannels: CreateEventChannelsAndAppMachineConfig,
    activeEvent: ActiveEventStatesConfig
  }
})

const AnearEventMachineFunctions = ({
  actions: {
    createAppEventMachine: assign({
      appEventMachine: context => {
        const machine = context.appEventMachineFactory(context.anearEvent)
        const service = interpret(machine)
        service.subscribe(AppMachineTransition(context.anearEvent))
        return service.start()
      }
    }),
    notifyAppMachineRendered: (context, event) => {
      if (context.appEventMachine) {
        logger.debug('[AEM] Sending RENDERED to AppM')
        context.appEventMachine.send('RENDERED')
      }
    },
    createEventChannel: assign({
      eventChannel: context => RealtimeMessaging.getChannel(
        context.anearEvent.eventChannelName,
        context.anearEvent
      )
    }),
    createActionsChannel: assign({
      actionsChannel: context => RealtimeMessaging.getChannel(
        context.anearEvent.actionsChannelName,
        context.anearEvent
      )
    }),
    createSpectatorsChannel: assign({
      spectatorsDisplayChannel: context => RealtimeMessaging.getChannel(
        context.anearEvent.spectatorsChannelName,
        context.anearEvent
      )
    }),
    enableSpectatorPresenceEvents: context => {
      // future spectators who (un)attach to the spectatorsDisplayChannel will
      // trigger presence events to the anearEventMachine
      RealtimeMessaging.enablePresenceCallbacks(
        context.spectatorsDisplayChannel,
        context.anearEvent,
        C.SpectatorPresencePrefix,
        C.SpectatorPresenceEvents
      )
    },
    enableParticipantPresenceEvents: context => {
      // future participants who (un)attach to the actionsChannel will
      // trigger presence events to the anearEventMachine
      RealtimeMessaging.enablePresenceCallbacks(
        context.actionsChannel,
        context.anearEvent,
        C.ParticipantPresencePrefix,
        C.ParticipantPresenceEvents
      )
    },
    subscribeToActionMessages: context => {
      RealtimeMessaging.subscribe(
        context.actionsChannel,
        context.anearEvent,
        'ACTION'
      )
    },
    subscribeToEventMessages: context => RealtimeMessaging.subscribe(
      context.eventChannel,
      context.anearEvent
    ),
    createParticipantsDisplayChannel: assign({
      participantsDisplayChannel: context => RealtimeMessaging.getChannel(
        context.anearEvent.participantsChannelName,
        context.anearEvent
      )
    }),
    startNewParticipantMachine: assign((context, event) => {
      const { anearParticipant } = event.data

      if (!anearParticipant) return {}

      if (context.participants[anearParticipant.id]) {
        logger.debug(`[AEM] participant entry for ${anearParticipant.id} already exists`)
        return {}
      }

      logger.debug("[AEM] starting new participant machine for: ", anearParticipant)

      const service = AnearParticipantMachine(
        anearParticipant,
        context
      )

      return {
        participantMachines: {
          ...context.participantMachines,
          [anearParticipant.id]: service.start()
        },
        participants: {
          ...context.participants,
          [anearParticipant.id]: anearParticipant.participantInfo
        }
      }
    }),
    sendSpectatorEnterToAppEventMachine: (context, event) => {
      const spectators = [].concat(event.data || [])
      spectators.forEach(
        // app can trigger a meta display for Spectator
        userJSON => context.appEventMachine.send('SPECTATOR_ENTER', userJSON)
      )
    },
    sendEnterToAppMachine: (context, event) => {
      const anearParticipant = event.data?.anearParticipant ?? event.anearParticipant;

      if (!anearParticipant) {
        logger.error('[AEM] sendEnterToAppMachine was called without an anearParticipant in the event', event);
        return;
      }
      const participantInfo = context.participants[anearParticipant.id]

      if (!participantInfo) {
        logger.error(`[AEM] participantInfo not found for ${anearParticipant.id} in sendEnterToAppMachine`);
        return;
      }

      const isHost = anearParticipant.isHost;
      const eventName = isHost ? 'HOST_ENTER' : 'PARTICIPANT_ENTER';
      const eventPayload = { participant: participantInfo };

      logger.debug(`[AEM] Sending ${eventName} for ${anearParticipant.id}`);
      context.appEventMachine.send(eventName, eventPayload);
    },
    processDisconnectEvents: (context, event) => {
      const participantId = event.data.id;
      const participant = context.participants[participantId];
      const isHost = participant && participant.isHost;
      const eventName = isHost ? 'HOST_DISCONNECT' : 'PARTICIPANT_DISCONNECT';
      const participantMachine = context.participantMachines[participantId];

      logger.debug(`[AEM] processing disconnect for ${participantId}. Is host? ${isHost}`);
      if (participantMachine) {
        participantMachine.send('PARTICIPANT_DISCONNECT');
      }
      context.appEventMachine.send(eventName, { participantId });
    },
    processReconnectEvents: (context, event) => {
      const participantId = event.data.id;
      const participant = context.participants[participantId];
      const isHost = participant && participant.isHost;
      const eventName = isHost ? 'HOST_RECONNECT' : 'PARTICIPANT_RECONNECT';
      const participantMachine = context.participantMachines[participantId];

      logger.debug(`[AEM] processing reconnect for ${participantId}. Is host? ${isHost}`);
      if (participantMachine) {
        participantMachine.send('PARTICIPANT_RECONNECT');
      }
      context.appEventMachine.send(eventName, { participantId });
    },
    sendExitToAppMachine: (context, event) => {
      // coming from an action channel message, event.data.id
      const participantId = event.data.id;
      const participantInfo = context.participants[participantId];
      if (participantInfo) {
        logger.debug(`[AEM] sending PARTICIPANT_EXIT to AppM for participant ${participantId}`);
        context.appEventMachine.send('PARTICIPANT_EXIT', { participantId });
      } else {
        logger.warn(`[AEM] Participant info not found for id ${participantId} during sendExitToAppMachine`);
      }
    },
    sendHostExitToAppMachine: (context, event) => {
      const participantId = event.data.id;
      logger.debug(`[AEM] sending HOST_EXIT to AppM for host ${participantId}`);
      context.appEventMachine.send('HOST_EXIT', { participantId });
    },
    sendExitToParticipantMachine: (context, event) => {
      // coming from an action channel message, event.data.id
      const participantMachine = context.participantMachines[event.data.id]
      if (participantMachine) {
        logger.debug("[AEM] sending PARTICIPANT_EXIT to ", participantMachine.id)
        participantMachine.send('PARTICIPANT_EXIT')
      } else {
        logger.warn(`[AEM] Participant machine not found for id ${event.data.id} during sendExitToParticipantMachine`)
      }
    },
    sendParticipantExitEvents: context => {
      Object.values(context.participantMachines).forEach(pm => pm.send('PARTICIPANT_EXIT'))
    },


    updateParticipantPresence: (context, event) => {
      // lookup the participantMachine and update its context
      const participantMachine = context.participantMachines[event.data.id]
      if (participantMachine) {
        // opportunity to send presence data update like geoLocation, and
        // to inform app that a participant still has interest in the possibly long
        // running, light-participation event
        participantMachine.send('PARTICIPANT_UPDATE', event.data)
      }
      context.appEventMachine.send('PARTICIPANT_UPDATE', event.data)
    },
    processParticipantAction: (context, event) => {
      // event.data.participantId,
      // event.data.payload: {"appEventMachineACTION": {action event keys and values}}
      //   e.g.  {"MOVE":{"x":1, "y":2}}
      // send to the ParticipantMachine to handle state of participant (idle, active, timed-out, etc)
      const participantId = event.data.participantId
      const eventMessagePayload = JSON.parse(event.data.payload) // { eventName: {eventObject} }
      const [appEventName, payload] = Object.entries(eventMessagePayload)[0]

      logger.debug(`[AEM] got Event ${appEventName} from payload from participant ${participantId}`)

      const actionEventPayload = {
        participantId,
        payload
      }

      const participantMachine = context.participantMachines[participantId]

      participantMachine.send('ACTION', actionEventPayload)

      context.appEventMachine.send(appEventName, actionEventPayload)
    },
    processAndForwardAction: (context, event) => {
      const participantId = event.data.participantId;
      const { nonResponders } = context.participantsActionTimeout;

      // Check if this is the last responder before the context is updated.
      // This assumes the current participant IS a non-responder.
      const isFinalAction = nonResponders.size === 1 && nonResponders.has(participantId);

      logger.info(`[AEM] Participants FINAL ACTION is ${isFinalAction}`)

      // Forward to AppM with the finalAction flag
      const eventMessagePayload = JSON.parse(event.data.payload);
      const [appEventName, payload] = Object.entries(eventMessagePayload)[0];
      const appM_Payload = {
        participantId,
        payload,
        finalAction: isFinalAction
      };
      context.appEventMachine.send(appEventName, appM_Payload);

      // Forward to APM (without the flag)
      const participantMachine = context.participantMachines[participantId];
      if (participantMachine) {
        const apm_Payload = { participantId, payload };
        participantMachine.send('ACTION', apm_Payload);
      }
    },
    processParticipantTimeout: (context, event) => context.appEventMachine.send(
      'PARTICIPANT_TIMEOUT',
      { participantId: event.participantId }
    ),
    setupParticipantsTimeout: assign((context, event) => {
      const timeoutMsecs = event.data.participantsTimeout.msecs
      const allParticipantIds = getPlayingParticipantIds(context)
      logger.debug(`[AEM] Starting participants action timeout for ${timeoutMsecs}ms. Responders: ${allParticipantIds.join(', ')}`)

      return {
        participantsActionTimeout: {
          msecs: timeoutMsecs,
          nonResponders: new Set(allParticipantIds)
        }
      }
    }),
    processParticipantResponse: assign((context, event) => {
      const participantId = event.data.participantId
      const { nonResponders, ...rest } = context.participantsActionTimeout
      const newNonResponders = new Set(nonResponders)
      newNonResponders.delete(participantId)

      return {
        participantsActionTimeout: {
          ...rest,
          nonResponders: newNonResponders
        }
      }
    }),
    removeLeavingParticipantFromTimeout: assign((context, event) => {
      const participantId = event.data.id
      const { nonResponders, ...rest } = context.participantsActionTimeout
      const newNonResponders = new Set(nonResponders)
      newNonResponders.delete(participantId)

      return {
        participantsActionTimeout: {
          ...rest,
          nonResponders: newNonResponders
        }
      }
    }),
    sendActionsTimeoutToAppM: (context, _event) => {
      const { nonResponders, msecs } = context.participantsActionTimeout
      const nonResponderIds = [...nonResponders]
      logger.info(`[AEM] Participants action timed out. Non-responders: ${nonResponderIds.join(', ')}`)

      if (context.appEventMachine) {
        context.appEventMachine.send('ACTIONS_TIMEOUT', {
          timeout: msecs,
          nonResponderIds
        })
      }
    },
    clearParticipantsTimeout: assign({
      participantsActionTimeout: null
    }),
    cleanupExitingParticipant: assign((context, event) => {
      const { participantId } = event
      const participant = context.participants[participantId]

      logger.debug(`[AEM] cleaning up exiting participant ${participantId}`)

      if (participant) {
        const {
          [participantId]: removedParticipant,
          ...remainingParticipants
        } = context.participants

        const {
          [participantId]: removedMachine,
          ...remainingMachines
        } = context.participantMachines

        return {
          participants: remainingParticipants,
          participantMachines: remainingMachines
        }
      } else {
        return {}
      }
    }),
    notifyCoreServiceMachineExit: context => {
      logger.debug("[AEM] sending EVENT_MACHINE_EXIT to coreServiceMachine")
      context.coreServiceMachine.send('EVENT_MACHINE_EXIT', {eventId: context.anearEvent.id})
    },
    logCreatorEnter: (_c, event) => logger.debug("[AEM] got creator PARTICIPANT_ENTER: ", event.data.id),
    logAPMReady: (c, e) => logger.debug("[AEM] PARTICIPANT_MACHINE_READY for: ", e.data.anearParticipant.id),
    logInvalidParticipantEnter: (c, e) => logger.info("[AEM] Error: Unexepected PARTICIPANT_ENTER with id: ", e.data.id),
  },
  services: {
    renderDisplay: async (context, event) => {
      const displayEventProcessor = new DisplayEventProcessor(context)

      return await displayEventProcessor.processAndPublish(event.displayEvents)
    },
    getAttachedCreatorOrHost: async (context, event) => {
      logger.debug("[AEM] getAttachedCreatorOrHost() invoked")

      const members = await RealtimeMessaging.getPresenceOnChannel(context.actionsChannel)

      if (members.length === 0) return { anearParticipant: null }

      // event.data in onDone actions is
      // {
      //   anearParticipant
      // }
      const creatorData = members[0].data
      const participantJSON = await AnearApi.getEventParticipantJson(creatorData.id)
      const anearParticipant = new AnearParticipant(participantJSON, creatorData.geoLocation)

      return { anearParticipant }
    },
    getAttachedSpectators: async (context, event) => {
      const members = await RealtimeMessaging.getPresenceOnChannel(context.spectatorsDisplayChannel)
      return members
    },
    attachToParticipantsDisplayChannel: async context => RealtimeMessaging.attachTo(context.participantsDisplayChannel),
    attachToSpectatorsChannel: async context => RealtimeMessaging.attachTo(context.spectatorsDisplayChannel),
    attachToActionsChannel: async context => RealtimeMessaging.attachTo(context.actionsChannel),
    attachToEventChannel: async context => RealtimeMessaging.attachTo(context.eventChannel),
    detachChannels: async context => {
      const channels = [
        context.eventChannel,
        context.actionsChannel,
        context.participantsDisplayChannel,
      ]
      if (context.spectatorsDisplayChannel) channels.push(context.spectatorsDisplayChannel)
      await RealtimeMessaging.detachAll(channels)
    },
    fetchParticipantData: async (context, event) => {
      // event.data => {id: <participantId>, geoLocation: {}}
      const participantJSON = await AnearApi.getEventParticipantJson(event.data.id)
      const anearParticipant = new AnearParticipant(participantJSON, event.data.geoLocation)

      return { anearParticipant }
    },
    transitionAndGetAttachedSpectators: async (context, event) => {
      const transitionPromise = AnearApi.transitionEvent(context.anearEvent.id, 'announce')
      const membersPromise = RealtimeMessaging.getPresenceOnChannel(context.spectatorsDisplayChannel)
      const [_, members] = await Promise.all([transitionPromise, membersPromise])
      return members
    },
    transitionToLive: (context, event) => {
      return AnearApi.transitionEvent(context.anearEvent.id, 'live')
    },
    transitionToClosed: (context, event) => {
      return AnearApi.transitionEvent(context.anearEvent.id, 'closed')
    },

    transitionToCanceled: (context, event) => {
      return AnearApi.transitionEvent(context.anearEvent.id, 'canceled')
    },
    transitionToPaused: (context, event) => {
      return AnearApi.transitionEvent(context.anearEvent.id, 'paused')
    },
    eventTransitionClosed: async (context, event) => {
      // This service handles the transition of the event to 'closed' via AnearApi
      // and the publishing of the 'EVENT_TRANSITION' message to ABRs.
      // It's a promise that resolves when both operations are complete.
      const transitionPromise = AnearApi.transitionEvent(context.anearEvent.id, 'closed')
      const publishPromise = RealtimeMessaging.publish(context.eventChannel, 'EVENT_TRANSITION', { content: { state: 'closed' } })
      await Promise.all([transitionPromise, publishPromise])
      return 'done' // Indicate completion
    },
    eventTransitionCanceled: async (context, event) => {
      // This service handles the transition of the event to 'canceled' via AnearApi
      // and the publishing of the 'EVENT_TRANSITION' message to ABRs.
      // It's a promise that resolves when both operations are complete.
      const transitionPromise = AnearApi.transitionEvent(context.anearEvent.id, 'canceled')
      const publishPromise = RealtimeMessaging.publish(context.eventChannel, 'EVENT_TRANSITION', { content: { state: 'canceled' } })
      await Promise.all([transitionPromise, publishPromise])
      return 'done' // Indicate completion
    }
  },
  guards: {
    isPermanentLeave: (context, event) => {
      // The remote client has left the event.  This is a permanent exit
      // from the event
      const type = event.data.type
      switch (type) {
        case 'PARTICIPANT_EXIT':
          return true
        case 'EVENT_UNMOUNT':
          return false
        default:
          return false
      }
    },
    isHostLeaving: (context, event) => {
      const participantId = event.data.id;
      const participant = context.participants[participantId];
      return participant && participant.isHost;
    },
    participantExists: (context, event) => !!context.participants[event.data.id],
    eventCreatorIsHost: (context, event) => context.anearEvent.hosted,
    isOpenHouseEvent: (context, event) => context.anearEvent.openHouse || false,
    isParticipantsTimeoutActive: (context, event) => {
      return event.data && event.data.participantsTimeout && event.data.participantsTimeout.msecs > 0
    },
    allParticipantsResponded: (context, event) => {
      return context.participantsActionTimeout && context.participantsActionTimeout.nonResponders.size === 0
    }
  },
  delays: {
    // in the future, these delays should be goverened by the type of App and
    // if there has been activity.
    timeoutEventAnnounce: context => C.TIMEOUT_MSECS.ANNOUNCE,
    timeoutEventStart: context => C.TIMEOUT_MSECS.START,
    timeoutRendered: context => C.TIMEOUT_MSECS.RENDERED_EVENT_DELAY,
    participantsActionTimeout: (context, event) => {
      return context.participantsActionTimeout.msecs
    }
  }
})

const AnearEventMachine = (anearEvent, {
  coreServiceMachine,
  pugTemplates,
  appEventMachineFactory,
  appParticipantMachineFactory,
  imageAssetsUrl
}) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearEventMachineStatesConfig(anearEvent.id)}

  const eventMachine = createMachine(expandedConfig, AnearEventMachineFunctions)
  const pugHelpers = PugHelpers(imageAssetsUrl)

  const anearEventMachineContext = AnearEventMachineContext(
    anearEvent,
    coreServiceMachine,
    pugTemplates,
    pugHelpers,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  const service = interpret(eventMachine.withContext(anearEventMachineContext))

  anearEvent.setMachine(service)

  service.subscribe(state => {
    logger.debug('─'.repeat(40))
    logger.debug(`[AEM] EVENT → ${state.event.type}`)
    logger.debug(`[AEM] NEXT STATE → ${JSON.stringify(state.value)}`)
  })

  return service
}

module.exports = AnearEventMachine
