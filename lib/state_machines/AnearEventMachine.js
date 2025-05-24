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
const MetaProcessing = require('../utils/MetaProcessing')
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

const DeferredStates = [
  // do not process these if they arrive during an unresolved
  // invoke Promise service
  'RENDER_DISPLAY',
  'PARTICIPANT_ENTER',
  'PARTICIPANT_LEAVE',
  'PARTICIPANT_EXIT',
  'SPECTATOR_ENTER',
  'PARTICIPANT_TIMEOUT',
  'ACTION',
  'CANCEL',
  'CLOSE'
]

const DeferredStatesPlus = (...additionalStates) => DeferredStates.concat(additionalStates)

const ActiveEventGlobalEvents = {
  PARTICIPANT_EXIT: {
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
    actions: ['cleanupExitingParticipant']
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
      deferred: DeferredStates,
      invoke: {
        src: 'getAttachedCreatorOrHost',
        onDone: {
          actions: ['startNewParticipantMachine'],
          target: '.',
          internal: true
        },
        onError: {
          target: '#failure'
        }
      },
      on: {
        PARTICIPANT_READY: {
          actions: (c, e) => logger.debug("Got PARTICIPANT_READY for ", e.data.anearParticipant.id),
          target: '#eventCreated'
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
        'enableParticipantPresenceEvents',
        'enableSpectatorPresenceEvents'
      ],
      on: {
        RENDER_DISPLAY: {
          target: '#rendering'
        }
      },
      states: {
        waitingAnnounce: {
          id: 'waitingAnnounce',
          on: {
            ANNOUNCE: {
              target: '#activeEvent.announce'
            },
            START: {
              target: '#activeEvent.live'
            }
          }
        },
        rendering: {
          id: 'rendering',
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
          target: '#rendering'
        },
        PARTICIPANT_LEAVE: {
          // creator browser refresh or MIA.  Send disconnect events
          actions: ['sendParticipantDisconnectEvents']
        },
        PARTICIPANT_ENTER: [
          {
            // a participant could re-entering the event after above PARTICIPANT_LEAVE (browser refresh).
            // so look for existing participants and send reconnect events to interested machines
            cond: 'participantExists',
            actions: 'sendParticipantReconnectEvents',
            target: '#waitingToStart',
            internal: true
          },
          {
            // spectator clicked JOIN
            target: '#newParticipant'
          }
        ],
        SPECTATOR_ENTER: {
          actions: 'sendSpectatorEnterToAppEventMachine',
          target: '#waitingToStart',
          internal: true
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
          on: {
            START: {
              target: '#activeEvent.live'
            }
          }
        },
        rendering: {
          id: 'rendering',
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
        newParticipant: {
          // a PARTICIPANT_ENTER received from a new user JOIN click. create an AnearParticipantMachine instance.
          // This machine tracks presence, geo-location (when approved by mobile participant),
          // manages active/idle state for long-running events, and manages any ACTION timeouts.
          id: 'newParticipant',
          deferred: DeferredStatesPlus('START'),
          invoke: {
            src: 'fetchParticipantData',
            onDone: {
              actions: [
                'startNewParticipantMachine',
                'sendParticipantEnterToAppEventMachine'
              ],
              target: '#waitingToStart',
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        }
      }
    },
    live: {
      initial: 'transitioning',
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
            PAUSE: '#activeEvent.paused',
            CLOSE: '#activeEvent.closed'
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
            CLOSED: '#activeEvent.closed'
          }
        }
      }
    },
    closed: {
      id: 'closed',
      initial: 'transitioning',
      states: {
        transitioning: {
          deferred: DeferredStates,
          invoke: {
            src: 'transitionToClosed',
            onDone: {
              target: 'detaching',
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

  states: {
    setupEventChannel: {
      // get(eventChannelName) and setup state-change callbacks
      entry: [(c,e) => logger.debug(`=== NEW EVENT ${c.anearEvent.id} ===`), 'createEventChannel'],
      deferred: DeferredStates,
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
      deferred: DeferredStates,
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
        ATTACHED: 'setupActionsChannel'
      }
    },
    setupActionsChannel: {
      entry: 'createActionsChannel',
      deferred: DeferredStates,
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
          actions: ['subscribeToActionMessages'],
          target: 'setupSpectatorsChannel'
        }
      }
    },
    setupSpectatorsChannel: {
      entry: 'createSpectatorsChannel',
      deferred: DeferredStates,
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
        service.onTransition(MetaProcessing(context.anearEvent))
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
      const startEvent = { participant: participantInfo }

      context.appEventMachine.send('PARTICIPANT_ENTER', startEvent)
    },
    sendParticipantExitToAppEventMachine: (context, event) => {
      context.appEventMachine.send('PARTICIPANT_EXIT', event.participantId)
    },
    sendParticipantExitToParticipantMachine: (context, event) => {
      // coming from an ACTION message, event.data.participantId
      const participantMachine = context.participantMachines[event.data.participantId]
      if (participantMachine) {
        logger.debug("sending PARTICIPANT_EXIT to ", participantMachine.id)
        participantMachine.send('PARTICIPANT_EXIT', event.data)
      }
    },
    sendParticipantExitEvents: context => {
      Object.values(context.participantMachines).forEach(m => m.send('PARTICIPANT_EXIT'))
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
        context.appEventMachine.send('PARTICIPANT_DISCONNECT', event.data)
      }
    },
    sendParticipantReconnectEvents: (context, event) => {
      const participantMachine = context.participantMachines[event.data.id]
      if (participantMachine) {
        // suspends the disconnect timeout and restores participant presence state in
        // the event
        participantMachine.send('PARTICIPANT_RECONNECT', event.data)
      }
      // send this to the app so they can receive and trigger a meta display for private participants
      context.appEventMachine.send('PARTICIPANT_RECONNECT', event.data)
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
        type: appEventName, // the appEventMachine handles this event name
        participantId,
        payload
      }

      const participantMachine = context.participantMachines[participantId]

      participantMachine.send('ACTION', actionEventPayload)
      context.appEventMachine.send(actionEventPayload)
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
      logger.debug("sending EVENT_MACHINE_EXIT to ACSM")
      context.coreServiceMachine.send('EVENT_MACHINE_EXIT', {eventId: context.anearEvent.id})
    }
  },
  services: {
    renderDisplay: async (context, event) => {
      const processDisplayEvent = (context, displayEvent) => {
        const { displayType, viewPath, timeout, appExecutionContext } = displayEvent

        logger.debug("processDisplayEvent - displayType: ", displayType, ", viewPath: ", viewPath)

        const renderedDisplayContent = (template, additionalExecutionContext, timeout) => {
          const renderedMessage = template(
            {
              displayType,
              ...appExecutionContext,
              ...additionalExecutionContext,
              participants: context.participants,
              ...context.pugHelpers
            }
          )
          const displayContent = { content: renderedMessage }
          if (timeout) {
            displayContent['timeout'] = timeout
          }
          return displayContent
        }

        const privateParticipantSend = participantMachine => {
          const participantState = participantMachine.state
          const participantContext = participantState.context
          const { appParticipantMachine, anearParticipant } = participantContext

          // TODO: don't send to participants that aren't in an active state

          const appParticipantContext =
            appParticipantMachine ? participantContext.appParticipantMachine.state.context : {}

          const privateContext = {
            anearParticipant: anearParticipant.participantInfo,
            participantContext: appParticipantContext
          }

          const displayEventPayload = renderedDisplayContent(template, privateContext, timeout)

          participantMachine.send('PRIVATE_DISPLAY', displayEventPayload)
        }

        const normalizedPath = viewPath.endsWith(C.PugSuffix) ? viewPath : `${viewPath}${C.PugSuffix}`
        const template = context.pugTemplates[normalizedPath]
        if (!template) {
          throw new Error(`Template not found for path "${normalizedPath}".`)
        }
        let displayMessage

        switch (displayType) {
          case 'participants':
            displayMessage = renderedDisplayContent(template, {}, timeout)
            return RealtimeMessaging.publish(
              context.participantsDisplayChannel,
              'PARTICIPANTS_DISPLAY',
              displayMessage
            )
            break
          case 'spectators':
            displayMessage = renderedDisplayContent(template, {})
            return RealtimeMessaging.publish(
              context.spectatorsDisplayChannel,
              'SPECTATORS_DISPLAY',
              displayMessage
            )
            break
          case 'participant':
            // For private displays, iterate over active active participant machines.
            Object.values(context.participantMachines).forEach(privateParticipantSend)
            return Promise.resolve()
            break
          default:
            throw new Error(`Unknown display type: ${displayType}`)
        }
      }

      const publishPromises = event.displayEvents.map(
        displayEvent => processDisplayEvent(context, displayEvent)
      )
      return Promise.all(publishPromises)
    },
    getAttachedCreatorOrHost: async (context, event) => {
      logger.debug("getAttachedCreatorOrHost() invoked")

      const members = await RealtimeMessaging.getPresenceOnChannel(context.actionsChannel)

      if (members.length === 0) throw new Error("missing creator presence on Actions channel")

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
      const participantJSON = await AnearApi.getEventParticipantJson(event.id)
      const anearParticipant = new AnearParticipant(participantJSON, event.geoLocation)

      return {
        anearParticipant
      }
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
    participantExists: (context, event) => !!context.participants[event.id],
    eventCreatorIsHost: (context, event) => context.anearEvent.hosted
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
