"use strict"
const logger = require('../utils/Logger')

//
// A N E A R   E V E N T   M A C H I N E
//  Incoming Messages
//    - Event Messages
//      - route to appEventMachine
//    - Participant Enter / Leave Presence Messages
//      - route to appEventMachine
//    - Participant Exit
//      - participant deliberately exited event
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

const AnearApi = require('../api/AnearApi')
const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')
const AnearParticipant = require('../models/AnearParticipant')
const RealtimeMessaging = require('../utils/RealtimeMessaging')
const AppMachineTransition = require('../utils/AppMachineTransition')
const DisplayEventProcessor = require('../utils/DisplayEventProcessor')
const PugHelpers = require('../utils/PugHelpers')
const C = require('../utils/Constants')

const AnearEventChannels = {
  eventChannel: null,               // event control messages
  actionsChannel: null,             // participant presence/live actions
  participantsDisplayChannel: null, // display all participants
  spectatorsDisplayChannel: null    // display all spectators
}

const AnearEventMachineContext = (
  anearEvent,
  coreServiceMachine,
  pugTemplates,
  pugHelpers,
  appEventMachineFactory,
  appParticipantMachineFactory
) => (
  {
    anearEvent,
    coreServiceMachine,
    pugTemplates,
    pugHelpers,
    ...AnearEventChannels,
    appEventMachineFactory,
    appParticipantMachineFactory,
    appEventMachine: null, // third-party app machine
    participantMachines: {},
    participants: {}
  }
)

const MinuteMsecs = minutes => minutes * (60 * 1000)

const DeferredStates = [
  // do not process these if they arrive during an unresolved
  // invoke Promise service
  'RENDER_DISPLAY',
  'PARTICIPANT_ENTER', // actions channel presence enter event
  'PARTICIPANT_LEAVE', // actions channel presence leave event
  'PARTICIPANT_EXIT',  // participant did a deliberate exit click in the event browser
  'SPECTATOR_ENTER',
  'PARTICIPANT_TIMEOUT',
  'ACTION',
  'CANCEL',
  'CLOSE'
]

const DeferredStatesPlus = (...additionalStates) => DeferredStates.concat(additionalStates)

const ActiveEventGlobalEvents = {
  PARTICIPANT_EXIT: {
    // Participant deliberately exited the event via navigation controls
    //
    // If any participant explicitly exits, notify the AppM so it can determine
    // what effect the exiting participant will have on the event in progress.
    // e.g. If event creator is exiting and the event has not started, the AppM can just
    // terminate.  Or, it may just remove a participant from the game, and continue play
    actions: [
      'sendParticipantExitToAppEventMachine',
      'sendParticipantExitToParticipantMachine'
    ]
  },
  PARTICIPANT_MACHINE_EXIT: {
    // the AnearParticipantMachine has hit its final state
    actions: ['cleanupExitingParticipant']
  },
  APP_FINAL: {
    // AppM has reached a final state, initiate orderly shutdown
    target: '#activeEvent.closeEvent',
    cond: context => !context.anearEvent.state?.matches('activeEvent.closeEvent')
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
                  actions: 'logAPMReady',
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
    // reached, host setupu is complete, and/or its 8pm ... time to start
    eventCreated: {
      id: 'eventCreated',
      initial: 'waitingAnnounce',
      entry: [
        'sendParticipantEnterToAppEventMachine',
        'enableSpectatorPresenceEvents'
      ],
      on: {
        RENDER_DISPLAY: {
          target: '#createdRendering'
        }
      },
      states: {
        waitingAnnounce: {
          id: 'waitingAnnounce',
          after: {
            timeoutEventAnnounce: {
              actions: context => logger.info(`Event ${context.anearEvent.id} TIMED OUT waiting for ANNOUNCE`),
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
              target: '#waitingAnnounce',
              internal: true
            },
            onError: {
              target: '#activeEvent.failure'
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
        RENDER_DISPLAY: {
          target: '#announceRendering'
        },
        PARTICIPANT_LEAVE: {
          // creator browser refresh or MIA. Send disconnect events
          actions: ['sendParticipantDisconnectEvents']
        },
        PARTICIPANT_ENTER: [
          {
            // a participant could re-entering the event after above PARTICIPANT_LEAVE (browser refresh).
            // so look for existing participants and send reconnect events to interested machines
            cond: 'participantExists',
            actions: 'sendParticipantReconnectEvents'
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
          entry: (c, e) => logger.debug("announce state...waiting for event START"),
          after: {
            timeoutEventStart: {
              actions: context => logger.info(`Event ${context.anearEvent.id} TIMED OUT waiting for START`),
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
            onDone: {
              target: '#waitingToStart',
              internal: true
            },
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
        waitParticipantReady: {
          id: 'waitParticipantReady',
          deferred: DeferredStatesPlus('START'),
          on: {
            PARTICIPANT_MACHINE_READY: {
              actions: ['sendParticipantEnterToAppEventMachine'],
              target: '#waitingToStart',
              internal: true
            }
          }
        }
      }
    },
    live: {
      initial: 'transitioning',
      on: {
        RENDER_DISPLAY: {
          target: '#liveRendering'
        },
        SPECTATOR_ENTER: {
          actions: 'sendSpectatorEnterToAppEventMachine'
        },
        PARTICIPANT_LEAVE: {
          // mid-event browser refresh or MIA.  Send disconnect events
          actions: ['sendParticipantDisconnectEvents']
        },
        PARTICIPANT_TIMEOUT: {
          action: ['processParticipantTimeout']
        },
        PAUSE: '#activeEvent.paused', // Currently no use-case for these
        CLOSE: '#activeEvent.closeEvent'
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
          on: {
            PARTICIPANT_ENTER: [
              {
                // a participant could re-entering the event after above PARTICIPANT_LEAVE (browser refresh).
                // so look for existing participants and send reconnect events to interested machines
                cond: 'participantExists',
                actions: 'sendParticipantReconnectEvents'
              },
              {
                // in the future, open house events allow spectators to join and leave freely
                // during live.waitingForActions
                cond: 'isOpenHouseEvent',
                target: 'participantEntering'
              },
              {
                // shouldn't receive these so log it and return to current state
                actions: ['logInvalidParticipantEnter'],
                target: '#activeEvent.failure'
              }
            ],
            ACTION: {
              // A participant has clicked an anear-data-action
              actions: ['processParticipantAction']
            }
          }
        },
        liveRendering: {
          id: 'liveRendering',
          deferred: DeferredStates,
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: '#waitingForActions',
              internal: true
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
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
              actions: ['sendParticipantEnterToAppEventMachine'],
              target: '#waitingForActions',
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
          deferred: DeferredStatesPlus('RESUME', 'CLOSED'),
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
            CLOSED: '#activeEvent.closeEvent'
          }
        }
      }
    },
    closeEvent: {
      id: 'closeEvent',
      initial: 'transitioning',
      states: {
        transitioning: {
          deferred: DeferredStates,
          invoke: {
            src: 'transitionToClosed',
            onDone: {
              target: 'waitForParticipantsToExit',
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waitForParticipantsToExit: {
          entry: ['sendExitDisplayToAllParticipants'],
          on: {
            PARTICIPANT_EXIT: {
              // participant with event.data.id clicked exit event nav
              // we want to exit APM
              actions: ['sendParticipantExitToParticipantMachine']
            },
            PARTICIPANT_LEAVE: {
              // a participant got exit in display message or closed/refreshed page/browser
              // we want to exit APM
              actions: ['sendParticipantExitToParticipantMachine']
            },
            PARTICIPANT_ENTER: {
              actions: (c, e) => logger.debug("Got PARTICIPANT ENTER during close with id: ", e.data.id)
              // might want to send a display event with exit: true
            }
          },
          always: [
            {
              cond: context => Object.keys(context.participants).length === 0,
              target: 'detaching'
            }
          ]
        },
        detaching: {
          deferred: DeferredStates,
          invoke: {
            src: 'detachChannels',
            onDone: {
              target: '#activeEvent.cleanupAndExit'
            }
          }
        }
      }
    },
    canceled: {
      id: 'canceled',
      initial: 'transitioning',
      states: {
        transitioning: {
          deferred: DeferredStates,
          invoke: {
            src: 'transitionToCanceled',
            onDone: {
              target: 'detaching'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        detaching: {
          deferred: DeferredStates,
          invoke: {
            src: 'detachChannels',
            onDone: {
              target: '#activeEvent.cleanupAndExit'
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
    cleanupAndExit: {
      id: 'cleanupAndExit',
      entry: ['sendParticipantExitEvents'],
      on: {
        PARTICIPANT_MACHINE_EXIT: {
          actions: 'cleanupExitingParticipant'
        }
      },
      always: [
        {
          cond: context => Object.keys(context.participants).length === 0,
          target: 'doneExit'
        }
      ]
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
          logger.error("Stack trace:", event.data.stack);
        } else {
          logger.error("Error details:", event.data);
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
      entry: [(c,e) => logger.debug(`=== NEW EVENT ${c.anearEvent.id} ===`), 'createEventChannel'],
      invoke: {
        src: 'attachToEventChannel',
        onDone: {
          target: 'setupEventChannel',
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
        const service = interpret(context.appEventMachineFactory(context.anearEvent))
        service.onTransition(AppMachineTransition(context.anearEvent))
        return service.start()
      }
    }),
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
      RealtimeMessaging.subscribe(
        context.actionsChannel,
        context.anearEvent,
        'PARTICIPANT_EXIT'
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
        logger.debug(`participant entry for ${anearParticipant.id} already exists`)
        return {}
      }

      logger.debug("starting new participant machine for: ", anearParticipant)

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
    sendParticipantEnterToAppEventMachine: (context, event) => {
      const { anearParticipant } = event.data
      const participantInfo = context.participants[anearParticipant.id]

      logger.debug(`Participant machine ${participantInfo.id} is READY`)

      const startEvent = { participant: participantInfo }

      context.appEventMachine.send('PARTICIPANT_ENTER', startEvent)
    },
    sendParticipantExitToAppEventMachine: (context, event) => {
      // This participant is not coming back.  App can end game or just work them
      // out of the game play
      context.appEventMachine.send('PARTICIPANT_EXIT', { participantId: event.data.id })
    },
    sendParticipantExitToParticipantMachine: (context, event) => {
      // coming from an action channel message, event.data.id
      const participantMachine = context.participantMachines[event.data.id]
      if (participantMachine) {
        logger.debug("sending PARTICIPANT_EXIT to ", participantMachine.id)
        participantMachine.send('PARTICIPANT_EXIT')
      }
    },
    sendParticipantExitEvents: context => {
      Object.values(context.participantMachines).forEach(pm => pm.send('PARTICIPANT_EXIT'))
    },
    sendExitDisplayToAllParticipants: context => {
      // Send exit display message to all participants
      Object.values(context.participantMachines).forEach(pm => {
        pm.send('PRIVATE_DISPLAY', {
          content: '', // Content is AppM's responsibility
          exit: true
        })
      })
    },

    sendParticipantDisconnectEvents: (context, event) => {
      const participantMachine = context.participantMachines[event.data.id]
      if (participantMachine) {
        logger.debug("sending PARTICIPANT_DISCONNECT to APM and AppM")
        // triggers a timer state in APM to timeout a missing Participant
        participantMachine.send('PARTICIPANT_DISCONNECT', event.data)
        // gives the App the opportunity to process the potential early exit
        // of a key player, possibly pausing or altering game behavior until
        // the participant either times out (exits game), or comes back after
        // the momentary outage
        context.appEventMachine.send('PARTICIPANT_DISCONNECT', { participantId: event.data.id })
      }
    },
    sendParticipantReconnectEvents: (context, event) => {
      const participantId = event.data.id
      const participantMachine = context.participantMachines[participantId]
      if (participantMachine) {
        // suspends the disconnect timeout and restores participant presence state in
        // the event
        participantMachine.send('PARTICIPANT_RECONNECT')
      }

      const participantInfo = context.participants[participantId]
      // send this to the app so they can receive and trigger a meta display for private participants
      if (participantInfo) {
        context.appEventMachine.send('PARTICIPANT_RECONNECT', { participant:  participantInfo })
      }
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
      const actionEventPayload = {
        participantId,
        payload
      }

      const participantMachine = context.participantMachines[participantId]

      participantMachine.send('ACTION', actionEventPayload)

      context.appEventMachine.send(appEventName, actionEventPayload)
    },
    processParticipantTimeout: (context, event) => context.appEventMachine.send(
      'PARTICIPANT_TIMEOUT',
      { participantId: event.participantId }
    ),
    cleanupExitingParticipant: assign((context, event) => {
      const { participantId } = event
      const participant = context.participants[participantId]

      logger.debug(`cleaning up exiting participant ${participantId}`)

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
      logger.debug("sending EVENT_MACHINE_EXIT to coreServiceMachine")
      context.coreServiceMachine.send('EVENT_MACHINE_EXIT', {eventId: context.anearEvent.id})
    },
    logCreatorEnter: (_c, event) => logger.debug("got creator PARTICIPANT_ENTER: ", event.data.id),
    logAPMReady: (c, e) => logger.debug("PARTICIPANT_MACHINE_READY for: ", e.data.anearParticipant.id),
    logInvalidParticipantEnter: (c, e) => logger.info("Error: Unexepected PARTICIPANT_ENTER with id: ", e.data.id),
  },
  services: {
    renderDisplay: (context, event) => {
      const displayEventProcessor = new DisplayEventProcessor(context)

      return displayEventProcessor.processAndPublish(event.displayEvents)
    },
    notifyParticipantsExit: (context, event) => {
      return displayEventProcessor.processAndPublish(event.displayEvents)
    },
    getAttachedCreatorOrHost: async (context, event) => {
      logger.debug("getAttachedCreatorOrHost() invoked")

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
    }
  },
  guards: {
    participantExists: (context, event) => !!context.participants[event.data.id],
    eventCreatorIsHost: (context, event) => context.anearEvent.hosted,
    isOpenHouseEvent: (context, event) => context.anearEvent.openHouse || false // TODO: need to have App open_house trait exposed in anear api
  },
  delays: {
    // in the future, these delays should be goverened by the type of App and
    // if there has been activity.
    timeoutEventAnnounce: context => MinuteMsecs(C.TIMEOUT_MINUTES.ANNOUNCE),
    timeoutEventStart: context => MinuteMsecs(C.TIMEOUT_MINUTES.START)
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
    logger.debug(`AEM EVENT → ${state.event.type}`)
    logger.debug(`AEM NEXT STATE → ${JSON.stringify(state.value)}`)
  })

  return service
}

module.exports = AnearEventMachine
