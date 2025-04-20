"use strict"
const logger = require('../utils/Logger')

//
// A N E A R   E V E N T   M A C H I N E
//  Incoming Messages
//    - Event Messages
//      - route to appEventMachine
//    - Participant Enter / Leave Presence Messages
//      - route to appEventMachine
//    - Participant Actions
//      - route to appEventMachine
//      - route to anearParticipantMachine
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
  pugTemplates,
  pugHelpers,
  appEventMachineFactory,
  appParticipantMachineFactory
) => (
  {
    anearEvent,
    pugTemplates,
    pugHelpers,
    ...AnearEventChannels,
    appEventMachineFactory,
    appParticipantMachineFactory,
    appEventMachine: null, // third-party app spawned child machine
    anearParticipantMachines: {}, // all active/idle participant child machines
    participants: {}
  }
)

const DeferredStates = [
  // do not process these if they arrive during an unresolved
  // invoke Promise state
  'CANCEL',
  'START',
  'RENDER_DISPLAY',
  'PARTICIPANT_ENTER',
  'PARTICIPANT_LEAVE',
  'SPECTATOR_ENTER',
  'PARTICIPANT_TIMEOUT',
  'ACTION'
]

const GlobalEventConfig = {
  // AnearEventMachine handles these raw, mobile client-based events
  // and forwards as needed to the AppEventMachine and/or AnearParticipantMachine
  CANCEL: {
    target: '#activeEvent.canceled'  // client cancelled out of an event
  },
  REFRESH: {
    // (who sends this? outdated?) occurs when a participant leaves, then immediately re-enters an event.  Often triggered
    // when the client device drops then re-establishes their network connection or
    // reloads the event page in mobile browser
    // needs actions or invoke
    actions: (c, e) => logger.debug("REFRESH received:", e.data),
    target: '#activeEvent.hist'
  },
  PARTICIPANT_ENTER: {
    target: '#activeEvent.participantEnter'
  },
  SPECTATOR_ENTER: {
    actions: ['sendSpectatorEnterToAppEventMachine'],
    target: '#activeEvent.hist'
  },
  PARTICIPANT_LEAVE: {
    // Presence event. Ably drops the mobile browser connection, and doesn't immediately re-establish connection
    target: '#activeEvent.participantLeave'
  },
  PARTICIPANT_UPDATE: {
    // Presence event. Not currently implemented in Anear Browser App, but the future use-case
    // is that apps will be configured to send these perodically (user's will have granted
    // the app permission) so the app can have up-to-date user geo-location for ambulatory gaming
    target: '#activeEvent.participantUpdate'
  },
  //RENDER_DISPLAY: {
  //  target: '#activeEvent.renderDisplay'
  //},
  ACTION: {
    // Participant/Host ACTION.  Host ACTIONs can arrive during creeated/opening states
    // Route to AnearParticipantMachine to update participant state
    //
    actions: ['processParticipantAction'],
    target: '#activeEvent.hist',
  },
  PARTICIPANT_TIMEOUT: {
    //
    // occurs when a participant (or all participants) does/do not respond with an ACTION
    // in a configured amount of msecs
    actions: ['processParticipantTimeout'],
    target: '#activeEvent.hist'
  }
}

const ActiveEventStatesConfig = {
  id: 'activeEvent',
  initial: 'registerCreator',
  on: GlobalEventConfig, // handles global events

  states: {
    // deferred state processing
    participantEnter: {
      // Presence event. This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
      // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
      // and manages any ACTION timeouts.  Participants enter either as a JOIN browser click in the event, or as the event creator
      deferred: DeferredStates,
      invoke: {
        src: 'fetchParticipantData',
        onDone: {
          actions: ['startNewParticipantMachine', 'sendParticipantEnterToAppEventMachine'],
          target: '#activeEvent.hist'
        },
        onError: {
          target: '#activeEvent.failure'
        }
      }
    },
    participantLeave: {
      actions: [(c, e) => logger.debug(`participant ${e} leaving`)],
      target: '#activeEvent.hist'
    },
    participantUpdate: {
      target: '#activeEvent.hist'
    },
    hist: {
      type: 'history',
      history: 'deep'
    },
    registerCreator: {
      deferred: DeferredStates,
      invoke: {
        src: 'getAttachedCreatorOrHost',
        onDone: {
          actions: ['startNewParticipantMachine'],
          target: 'created'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    // created is the start state for the event, and both the
    // event creator/first-participant or host/emcee arrive here.
    // The first-participant probably wants to transition to
    // announce right away to allow opponents/team-members to
    // join via QR code scan.  The host likely wants to do some
    // setup which could take some time, and transition to announce
    // only when the game/event is properly setup or the right time
    // has arrived.  The appEventMachine is responsible for firing the
    // ANNOUNCE or START event at the appropriate time e.g. a quorum is
    // reached or its 8pm time to start
    created: {
      id: 'created',
      initial: 'waiting',
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
        waiting: {
          id: 'waiting',
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
          deferred: DeferredStates,
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: '#waiting',
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
      // Spectators can scan QR code and are taken to the event
      // landing page, and can click to JOIN now
      initial: 'transitioning',
      on: {
        RENDER_DISPLAY: {
          target: '#rendering'
        }
      },
      states: {
        transitioning: {
          deferred: DeferredStates,
          invoke: {
            src: 'transitionAndGetAttachedSpectators',
            onDone: {
              actions: ['sendSpectatorEnterToAppEventMachine'],
              target: 'waiting'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waiting: {
          id: 'waiting',
          entry: (c, e) => logger.debug("I am waiting for START"),
          on: {
            START: {
              target: '#activeEvent.live'
            },
          }
        },
        rendering: {
          id: 'rendering',
          deferred: DeferredStates,
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: '#waiting'
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
              target: 'waiting'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waiting: {
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
          deferred: DeferredStates,
          invoke: {
            src: 'transitionToPaused',
            onDone: {
              target: 'waiting'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waiting: {
          on: {
            RESUME: '#activeEvent.live',
            CLOSED: '#activeEvent.closed'
          }
        }
      }
    },
    closed: {
      initial: 'transitioning',
      states: {
        transitioning: {
          deferred: DeferredStates,
          invoke: {
            src: 'transitionToClosed',
            onDone: {
              target: 'waiting',
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        },
        waiting: {
          entry: ['detachChannels'],
          on: {
            NEXT: '#activeEvent.review',
            ARCHIVE: '#activeEvent.archived'
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
    canceled: {
      id: 'canceled',
      deferred: DeferredStates,
      invoke: {
        src: 'detachChannels',
        onDone: {
          target: 'doneExit'
        }
      }
    },
    doneExit: {
      // might need to tell the AnearCoreServiceMachine we are exiting for cleanup,
      // perhaps via a machine send or subscribe
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
      // creates the developer-provided AppEventMachine
      entry: 'createAppEventMachine',
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

  states: {
    createEventChannels: CreateEventChannelsAndAppMachineConfig,
    activeEvent: ActiveEventStatesConfig
  }
})

const AnearEventMachineFunctions = ({
  actions: {
    createEventChannel: assign(
      {
        eventChannel: context => RealtimeMessaging.getChannel(
          context.anearEvent.eventChannelName,
          context.anearEvent.machineRef
        )
      }
    ),
    createActionsChannel: assign(
      {
        actionsChannel: context => RealtimeMessaging.getChannel(
          context.anearEvent.actionsChannelName,
          context.anearEvent.machineRef
        )
      }
    ),
    createSpectatorsChannel: assign(
      {
        spectatorsDisplayChannel: context => RealtimeMessaging.getChannel(
          context.anearEvent.spectatorsChannelName,
          context.anearEvent.machineRef
        )
      }
    ),
    enableSpectatorPresenceEvents: context => {
      // future spectators who (un)attach to the spectatorsDisplayChannel will
      // trigger presence events to the anearEventMachine
      RealtimeMessaging.enablePresenceCallbacks(
        context.spectatorsDisplayChannel,
        context.anearEvent.machineRef,
        C.SpectatorPresencePrefix,
        C.SpectatorPresenceEvents
      )
    },
    enableParticipantPresenceEvents: context => {
      // future participants who (un)attach to the actionsChannel will
      // trigger presence events to the anearEventMachine
      RealtimeMessaging.enablePresenceCallbacks(
        context.actionsChannel,
        context.anearEvent.machineRef,
        C.ParticipantPresencePrefix,
        C.ParticipantPresenceEvents
      )
    },
    subscribeToActionMessages: context => RealtimeMessaging.subscribe(
      context.actionsChannel,
      context.anearEvent.machineRef,
      C.ActionEventName
    ),
    subscribeToEventMessages: context => RealtimeMessaging.subscribe(
      context.eventChannel,
      context.anearEvent.machineRef
    ),
    createParticipantsDisplayChannel: assign(
      {
        participantsDisplayChannel: context => RealtimeMessaging.getChannel(
          context.anearEvent.participantsChannelName,
          context.anearEvent.machineRef
        )
      }
    ),
    createAppEventMachine: assign(
      {
        appEventMachine: context => {
          const appMachine = interpret(context.appEventMachineFactory(context.anearEvent))
          const service = appMachine.onTransition(MetaProcessing(context.anearEvent))

          service.start()

          return service
        }
      }
    ),
    startNewParticipantMachine: assign(
      (context, event) => {
        const participantJSON = event.data.participantJSON
        if (context.anearParticipantMachines[participantJSON.data.id]) {
          logger.debug(`AnearParticipantMachine for ${participantJSON.data.id} already exists`)
          return {}
        }
        const anearParticipant = new AnearParticipant(participantJSON)
        const geoLocation = event.data.geoLocation

        logger.debug("starting new participant machine for: ", anearParticipant)

        const service = AnearParticipantMachine(
          anearParticipant,
          event.data.geoLocation,
          context
        )
        anearParticipant.machineRef = service

        service.start()

        return {
          anearParticipantMachines: {
            ...context.anearParticipantMachines,
            [anearParticipant.id]: service
          },
          participants: {
            ...context.participants,
            [anearParticipant.id]: anearParticipant.publicAttrs
          }
        }
      }
    ),
    sendSpectatorEnterToAppEventMachine: (context, event) => {
      const spectators = [].concat(event.data || [])
      spectators.forEach(
        userJSON => context.appEventMachine.send(C.SpectatorEnterEventName, userJSON)
      )
    },
    sendParticipantEnterToAppEventMachine: (context, event) => {
      const {participantJSON, geoLocation} = event.data
      const publicAttrs = context.participants[participantJSON.data.id]
      const startEvent = {participant: publicAttrs, geoLocation}

      context.appEventMachine.send(C.ParticipantEnterEventName, startEvent)
    },
    updateParticipantPresence: (context, event) => {
      // lookup the anearParticipantMachine and update their context
    },
    processParticipantAction: (context, event) => {
      // event.message.data.participantId,
      // event.message.data.payload: {"appEventMachineACTION": {action event keys and values}}
      //   e.g.  {"MOVE":{"x":1, "y":2}}
      // send to the ParticipantMachine to handle state of participant (idle, active, timed-out, etc)
      const participantId = event.message.data.participantId
      const eventMessagePayload = JSON.parse(event.message.data.payload) // { eventName: {eventObject} }
      const anearParticipantMachine = context.anearParticipantMachines[participantId]
      const [appEventName, payload] = Object.entries(eventMessagePayload)[0]

      const actionEventPayload = {
        type: appEventName, // the appEventMachine handles this event name
        participantId,
        payload
      }

      anearParticipantMachine.send(C.ActionEventName, actionEventPayload)
      context.appEventMachine.send(actionEventPayload)
    },
    processParticipantTimeout: (context, event) => context.appEventMachine.send(
      C.TimeoutEventName,
      { participantId: event.participantId }
    )
  },
  services: {
    renderDisplay: async (context, event) => {
      const processDisplayEvent = (context, displayEvent) => {
        const { displayType, viewPath, timeout, executionContext } = displayEvent

        logger.debug("processDisplayEvent - displayType: ", displayType, ", viewPath: ", viewPath)

        const renderedDisplayContent = (template, executionContext, timeout) => {
          const renderedMessage = template(
            {
              displayType,
              ...executionContext,
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

        const privateParticipantSend = anearParticipantMachine => {
          const participantState = anearParticipantMachine.state
          const participantContext = participantState.context

          // TODO: don't send to participants that aren't in an active state

          const appParticipantContext =
            participantContext.appParticipantMachine ? participantContext.appParticipantMachine.state.context : {}

          const privateContext = {
            displayType,
            anearParticipant: participantContext.anearParticipant,
            participantContext: appParticipantContext,
            participants: context.participants,
            ...executionContext
          }

          const displayEventPayload = renderedDisplayContent(template, privateContext, timeout)

          anearParticipantMachine.send(C.PrivateDisplayEventName, displayEventPayload)
        }

        const normalizedPath = viewPath.endsWith(C.PugSuffix) ? viewPath : `${viewPath}${C.PugSuffix}`
        const template = context.pugTemplates[normalizedPath]
        if (!template) {
          throw new Error(`Template not found for path "${normalizedPath}".`)
        }
        let displayMessage

        switch (displayType) {
          case 'participants':
            displayMessage = renderedDisplayContent(template, executionContext, timeout)
            return RealtimeMessaging.publish(
              context.participantsDisplayChannel,
              C.ParticipantsDisplayEventName,
              displayMessage
            )
            break
          case 'spectators':
            displayMessage = renderedDisplayContent(template, executionContext)
            return RealtimeMessaging.publish(
              context.spectatorsDisplayChannel,
              C.SpectatorsDisplayEventName,
              displayMessage
            )
            break
          case 'participant':
            // For private displays, iterate over active active participant machines.
            Object.values(context.anearParticipantMachines).forEach(privateParticipantSend)
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
      //   participantJSON,
      //   geoLocation
      // }
      const creatorData = members[0].data
      const participantJSON = await AnearApi.getEventParticipantJson(creatorData.id)
      return {
        participantJSON,
        geoLocation: creatorData.geoLocation
      }
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
      return {
        participantJSON,
        geoLocation: event.geoLocation
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
    transitionToPaused: (context, event) => {
      return AnearApi.transitionEvent(context.anearEvent.id, 'paused')
    }
  },
  guards: {
    eventCreatorIsHost: (context, event) => context.anearEvent.hosted
  }
})

const AnearEventMachine = (anearEvent, {
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
    pugTemplates,
    pugHelpers,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  const service = interpret(eventMachine.withContext(anearEventMachineContext))

  service.subscribe(state => {
    logger.info('─'.repeat(40))
    logger.info(`EVENT → ${state.event.type}`)
    logger.info(`NEXT STATE → ${JSON.stringify(state.value)}`)
  })
  return service
}

module.exports = AnearEventMachine
