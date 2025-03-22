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
  appEventMachineFactory,
  appParticipantMachineFactory
) => (
  {
    anearEvent,
    pugTemplates,
    ...AnearEventChannels,
    displayQueue: [],
    appEventMachineFactory,
    appParticipantMachineFactory,
    appEventMachine: null, // third-party app spawned child machine
    anearParticipantMachines: {} // all active/idle participant child machines
  }
)

const GlobalEventConfig = {
  // AnearEventMachine handles these raw, mobile client-based events
  // and forwards as needed to the AppEventMachine and/or AnearParticipantMachine
  CANCEL: '#canceled', // client cancelled out of an event
  RENDER_DISPLAY: {
    // the MetaProcessor will send this events when responding to meta: display: in the appStateMachine config
    actions: ['queueRenderDisplayEvents'],
    target: '.',
    internal: true
  },
  PARTICIPANTS_DISPLAY: {
    invoke: {
      src: 'publishParticipantsDisplay',
      onDone: {
        target: '#activeEvent.hist',
      },
      onError: {
        target: '#activeEvent.failure'
      }
    }
  },
  SPECTATORS_DISPLAY: {
    invoke: {
      src: 'publishSpectatorsDisplay',
      onDone: {
        target: '#activeEvent.hist',
      },
      onError: {
        target: '#activeEvent.failure'
      }
    }
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
    // Presence event. This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
    // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
    // and manages any ACTION timeouts.  Participants enter either as a JOIN browser click in the event, or as the event creator
    invoke: {
      src: 'fetchParticipantData',
      onDone: {
        actions: ['startNewParticipantMachine', 'sendParticipantEnterToAppEventMachine'],
        target: '#activeEvent.hist'
      },
      onError: {
        target: '#failure'
      }
    }
  },
  SPECTATOR_ENTER: {
    actions: ['sendSpectatorEnterToAppEventMachine'],
    target: '#activeEvent.hist'
  },
  PARTICIPANT_LEAVE: {
    // Presence event. Ably drops the mobile browser connection, and doesn't immediately re-establish connection
    target: '#participantExit'
  },
  PARTICIPANT_UPDATE: {
    // Presence event. Not currently implemented in Anear Browser App, but the future use-case
    // is that apps will be configured to send these perodically (user's will have granted
    // the app permission) so the app can have up-to-date user geo-location for ambulatory gaming
    actions: ['updateParticipantPresence'],
    internal: true,
    target: '.'
  },
  ACTION: {
    // Participant/Host ACTION.  Host ACTIONs can arrive during creeated/opening states
    // Route to AnearParticipantMachine to update participant state
    //
    actions: ['processParticipantAction'],
    target: '.',
    internal: true
  },
  PARTICIPANT_TIMEOUT: {
    //
    // occurs when a participant (or all participants) does/do not respond with an ACTION
    // in a configured amount of msecs
    actions: ['processParticipantTimeout'],
    target: '.',
    internal: true
  }
}

const ActiveEventStatesConfig = {
  id: 'activeEvent',
  initial: 'registerCreator',
  on: GlobalEventConfig, // handles global events

  states: {
    registerCreator: {
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
      entry: [
        'sendParticipantEnterToAppEventMachine',
        'enableParticipantPresenceEvents',
        'enableSpectatorPresenceEvents'
      ],
      initial: 'waiting',
      states: {
        waiting: {
          entry: 'flushDisplayQueue',
          on: {
            ANNOUNCE: {
              target: '#activeEvent.announce'
            },
            START: {
              target: '#activeEvent.live'
            },
            RENDER_DISPLAY: {
              target: 'rendering'
            }
          }
        },
        rendering: {
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: 'waiting'
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
      states: {
        transitioning: {
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
          entry: 'flushDisplayQueue',
          on: {
            RENDER_DISPLAY: 'rendering',
            START: '#activeEvent.live'
          }
        },
        rendering: {
          // The rendering phase handles an individual RENDER_DISPLAY event.
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: 'waiting'
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
          entry: 'flushDisplayQueue',
          on: {
            RENDER_DISPLAY: 'rendering',
            PAUSE: '#activeEvent.paused',
            CLOSE: '#activeEvent.closed'
          }
        },
        rendering: {
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: 'waiting',
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        }
      }
    },
    paused: {
      initial: 'transitioning',
      states: {
        transitioning: {
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
          entry: 'flushDisplayQueue',
          on: {
            RENDER_DISPLAY: 'rendering',
            // For example, RESUME might transition to live (via a parent's transition state)
            RESUME: '#activeEvent.live',
            CLOSED: '#activeEvent.closed'
          }
        },
        rendering: {
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: 'waiting'
            },
            onError: {
              target: '#activeEvent.failure'
            }
          }
        }
      }
    },
    closed: {
      initial: 'transitioning',
      states: {
        transitioning: {
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
          entry: ['flushDisplayQueue', 'detachChannels'],
          on: {
            NEXT: '#activeEvent.review',
            ARCHIVE: '#activeEvent.archived',
            RENDER_DISPLAY: 'rendering'
          }
        },
        rendering: {
          invoke: {
            src: 'renderDisplay',
            onDone: {
              target: 'waiting'
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
      type: 'final'
    },
    canceled: {
      id: 'canceled',
      invoke: {
        src: 'detachChannels',
        onDone: {
          target: 'doneExit'
        }
      }
    },
    doneExit: {
      type: 'final'
    },
    spectatorExit: {
      id: 'spectatorExit'
    },
    participantExit: {
      id: 'participantExit'
    },
    failure: {
      id: 'failure',
      entry: (context, event) => {
        // Log the entire error object.
        console.error("Failure encountered:", event);
        if (event.data && event.data.stack) {
          logger.error("Stack trace:", event.data.stack);
        } else {
          logger.error("Error details:", event.data);
        }
      },
      type: 'final'
    },
    hist: {
      type: 'history',
      history: 'deep'
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
        ATTACHED: 'setupActionsChannel'
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
          actions: ['subscribeToActionMessages'],
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
          actions: ['enableSpectatorPresenceEvents'],
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
    queueRenderDisplayEvents: assign({
      displayQueue: (context, event) => [...context.displayQueue, ...event.displayEvents]
    }),
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
      {
        anearParticipantMachines: (context, event) => {
          const participantJSON = event.data
          const anearParticipant = new AnearParticipant(participantJSON)

          logger.debug("New AnearParticipant data", anearParticipant)

          const service = AnearParticipantMachine(
            anearParticipant,
            event.geoLocation,
            context
          )
          anearParticipant.anearParticipantMachine = service

          service.start()

          return {
            ...context.anearParticipantMachines,
            [anearParticipant.id]: service
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
      const participantJSON = event.data
      context.appEventMachine.send(C.ParticipantEnterEventName, participantJSON)
    },
    updateParticipantPresence: (context, event) => {
      // lookup the anearParticipantMachine and update their context
    },
    sendLiveToParticipantMachines: (context, event) => {
      for (const participantMachine in context.anearParticipantMachines) {
        participantMachine.send(C.StartEventName)
      }
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
    ),
    flushDisplayQueue: assign({
      displayQueue: (context, event) => {
        if (context.displayQueue.length > 0) {
          context.anearEvent.machineRef.send(C.RenderDisplayEventName, {displayEvents: context.displayQueue})
        }
        return []
      }
    })
  },
  services: {
    renderDisplay: async (context, event) => {
      const processDisplayEvent = (context, displayEvent) => {
        const { displayType, viewPath, timeout, executionContext } = displayEvent

        logger.debug("processDisplayEvent - displayType: ", displayType, ", viewPath: ", viewPath)

        const renderedDisplayContent = (template, executionContext, timeout) => {
          const renderedMessage = template(executionContext)
          logger.debug('renderedMessage: ', renderedMessage)
          const displayContent = { content: renderedMessage }
          if (timeout) {
            displayContent['timeout'] = timeout
          }
          return displayContent
        }

        const privateParticipantSend = machine => {
          logger.debug("private participant machine: ", machine)
          const { state: participantState, context: participantContext } = machine

          if (!participantState.matches(C.ActiveStateName)) {
            return
          }

          const appParticipantContext =
            participantContext.appParticipantMachine ? participantContext.appParticipantMachine.context : {}

          const privateContext = {
            anearParticipant: participantContext.anearParticipant,
            participantContext: appParticipantContext,
            ...executionContext
          }

          const displayEventPayload = renderedDisplayContent(template, privateContext, timeout)

          logger.debug("rendered Message: ", displayEventPayload.content)

          machine.send(C.PrivateDisplayEventName, displayEventPayload)
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
      const members = await RealtimeMessaging.getPresenceOnChannel(context.actionsChannel)
      if (members.length === 0) throw new Error("missing creator presence on Actions channel")

      return AnearApi.getEventParticipantJson(members[0].data.id) // participantJSON avaialble in event.data in onDone
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
    fetchParticipantData: (context, event) => {
      // event.data => {id: <participantId>, geoLocation: {}}
      // returns Promise
      return AnearApi.getEventParticipantJson(event.data.id)
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
  appParticipantMachineFactory
}) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearEventMachineStatesConfig(anearEvent.id)}

  const eventMachine = createMachine(expandedConfig, AnearEventMachineFunctions)

  const anearEventMachineContext = AnearEventMachineContext(
    anearEvent,
    pugTemplates,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  return interpret(eventMachine.withContext(anearEventMachineContext))
}

module.exports = AnearEventMachine
