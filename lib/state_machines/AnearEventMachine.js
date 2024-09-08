"use strict"

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

const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')
const AnearParticipant = require('../models/AnearParticipant')
const MetaViewPathEventProcessing = require('../utils/MetaViewPathEventProcessing')
const constants = require('../utils/constants')

const AnearEventChannels = {
  eventChannel: null,               // event control messages
  actionsChannel: null,             // participant presence/live actions
  participantsDisplayChannel: null, // display all participants
  spectatorsDisplayChannel: null    // display all spectators
}

const AnearEventMachineContext = (
  anearEvent,
  anearApi,
  cssUrl,
  pugTemplates,
  realtimeMessaging,
  appEventMachineFactory,
  appParticipantMachineFactory
) => (
  {
    anearEvent,
    anearApi,
    cssUrl,
    pugTemplates,
    ...AnearEventChannels,
    anearParticipantMachines: {}, // all active/idle participant child machines
    appEventMachineFactory,
    appParticipantMachineFactory,
    appEventMachine: null, // third-party app spawned child machine
    realtimeMessaging
  }
)

const CreateEventChannelsStatesConfig = {
  // Creates all Ably channels needed at the start of the
  // event prior to its transitioning to announce and live.
  // 1. create events channel and subscribe to its messages, then transition upon ATTACHED
  // 2. create participants display channel, attach to it, and transition upon ATTACHED
  // 3. create actions channel and subscribe to its messages, then transition upon ATTACHED
  // 4. If the event supports spectators, cerate the specatators channel, attach to it,
  //    then transition upon ATTACHED
  // 5. transition to Create Event App Machine
  id: 'createChannels',
  initial: 'setupEventChannel',

  states: {
    setupEventChannel: {
      // get(eventChannelName) and setup state-change callbacks
      entry: 'createEventChannel',
      always: {
        target: 'subscribeEventMessages'
      }
    },
    subscribeEventMessages: {
      entry: 'subscribeToEventMessages',
      on: {
        // eventChannel ATTACHED via entry calling channel.subscribe()
        ATTACHED: 'createAttachToParticipantsDisplayChannel'
      }
    },
    createAttachToParticipantsDisplayChannel: {
      entry: 'createParticipantsDisplayChannel',
      invoke: {
        src: 'attachToParticipantsDisplayChannel',
        onDone: {
          target: 'createAttachToParticipantsDisplayChannel',
          internal: true
        },
        onError: {
          target: '#failure'
        }
      },
      on: {
        ATTACHED: 'setupActionsChannel'
      }
    },
    setupActionsChannel: {
      entry: 'createActionsChannel',
      always: {
        target: 'subscribeActionMessages'
      },
    },
    subscribeActionMessages: {
      entry: 'subscribeToActionMessages',
      on: {
        ATTACHED: [ // actions ATTACHED
          {
            cond: 'doesEventAllowSpectators',
            target: 'createAttachToSpectatorsChannel'
          },
          {
            target: '#createEventApp'
          }
        ]
      }
    },
    createAttachToSpectatorsChannel: {
      entry: 'createSpectatorsChannel',
      invoke: {
        src: 'attachToSpectatorsChannel',
        onDone: {
          target: 'createAttachToSpectatorsChannel',
          internal: true
        },
        onError: {
          target: '#failure'
        }
      },
      on: {
        ATTACHED: '#createEventApp' // spectatorsDisplayChannel ATTACHED
      }
    }
  }
}

const CreateEventAppStatesConfig = {
  // Create the developer-supplied App Machine, and prepare
  // for host presence events if the Event is hosted.
  id: 'createEventApp',
  initial: 'createEventAppMachine',

  states: {
    createEventAppMachine: {
      entry: 'createEventAppMachine',
      always: [
        {
          cond: 'isEventHosted',
          target: 'hostPresence'
        },
        {
          target: '#activeEvent'
        }
      ]
    },
    hostPresence: {
      entry: 'enableParticipantPresenceEvents',
      invoke: {
        src: 'getAndNotifyAttachedParticipants', // if Host is already attached
        onDone: {
          target: '#activeEvent' // if Host attaches in near future
        },
        onError: {
          target: '#failure'
        }
      }
    }
  }
}

const ParticipantAndSpectatorPresenceActionEventsConfig = {
  CANCEL: '#canceled',
  REFRESH: {
    entry: 'refreshParticipantView',
    target: '#activeEvent.hist'
  },
  PARTICIPANT_ENTER: {
    // This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
    // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
    // and manages any ACTION timeouts
    target: '#fetchParticipantData'
  },
  PARTICIPANT_LEAVE: {
    target: '#participantExit'
  },
  PARTICIPANT_UPDATE: {
    actions: ['updateParticipantPresence'],
    target: '#activeEvent.hist'
  },
  SPECTATOR_ENTER: {
    target: '#refreshSpectatorView'
  },
  SPECTATOR_LEAVE: {
    target: '#spectatorExit'
  },
  ATTACHED: {
    // spurious channel attached notifications (e.g. after Participants Display Channel first publish)
    target: '#activeEvent.hist'
  },
  ACTION: {
    // Participant/Host ACTION.  Host ACTIONs can arrive during creeated/opening states
    // Route to AnearParticipantMachine to update participant state
    //
    actions: ['processParticipantAction'],
    target: '#activeEvent.hist'
  },
  PARTICIPANT_TIMEOUT: {
    actions: ['processParticipantTimeout'],
    target: '#activeEvent.hist'
  },
  PARTICIPANTS_DISPLAY: {
    target: '#participantsDisplay'
  },
  SPECTATORS_DISPLAY: {
    target: '#spectatorsDisplay'
  },
  PUBLIC_DISPLAY: {
    // need to create a publicDisplayChannel
  }
}

const ActiveEventStatesConfig = {
  id: 'activeEvent',
  initial: 'created',
  on: ParticipantAndSpectatorPresenceActionEventsConfig,

  states: {
    created: {
      // these events come from the eventApphine as it is moves through it's event flow
      on: {
        ANNOUNCE: {
          actions: ['enableSpectatorPresenceEvents'],
          invoke: {
            src: 'getAndNotifyAttachedSpectators',
            onDone: {
              target: 'announce'
            },
            onError: {
              target: '#failure'
            }
          }
        },
        START: {
          actions: ['enableSpectatorPresenceEvents'],
          invoke: {
            src: 'getAndNotifyAttachedSpectators',
            onDone: {
              target: 'opening'
            },
            onError: {
              target: '#failure'
            }
          }
        }
      }
    },
    announce: {
      on: {
        NEXT: 'opening',
        START: 'opening',
      }
    },
    opening: {
      on: {
        NEXT: 'live',
      }
    },
    live: {
      on: {
        NEXT: 'closing',
        PAUSE: 'paused',
        CLOSE: 'closed',
      }
    },
    paused: {
      on: {
        RESUME: 'resuming'
      }
    },
    resuming: {
      on: {
        NEXT: 'live'
      }
    },
    closing: {
      on: {
        NEXT: 'closed'
      }
    },
    closed: {
      entry: 'detachChannels',
      on: {
        NEXT: 'review',
        ARCHIVE: 'archived'
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
    fetchParticipantData: {
      id: 'fetchParticipantData',
      invoke: {
        src: 'fetchParticipantData',
        onDone: {
          actions: ['startNewParticipantMachine', 'sendParticipantEnterToEventAppMachine'],
          target: '#activeEvent.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    refreshSpectatorView: {
      id: 'refreshSpectatorView',
      invoke: {
        src: 'refreshSpectatorView',
        onDone: {
          target: '#activeEvent.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    participantsDisplay: {
      id: 'participantsDisplay',
      invoke: {
        src: 'publishParticipantsDisplay',
        onDone: {
          target: '#activeEvent.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    spectatorsDisplay: {
      id: 'spectatorsDisplay',
      invoke: {
        src: 'publishSpectatorsDisplay',
        onDone: {
          target: '#activeEvent.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    hist: {
      // used to transition back to child state
      type: 'history',
      history: 'deep'
    },
    failure: {
      id: 'failure',
      type: 'final'
    }
  }
}

const AnearEventMachineStatesConfig = eventId => ({
  id: `anearEventMachine_${eventId}`,
  initial: 'createEventChannels',

  states: {
    createEventChannels: CreateEventChannelsStatesConfig,
    createEventApp: CreateEventAppStatesConfig,
    activeEvent: ActiveEventStatesConfig
  }
})

const AnearEventMachineFunctions = ({
  actions: {
    createEventChannel: assign(
      {
        eventChannel: context => context.realtimeMessaging.getChannel(
          context.anearEvent.eventChannelName,
          context.anearEvent.anearEventMachine
        )
      }
    ),
    createActionsChannel: assign(
      {
        actionsChannel: context => context.realtimeMessaging.getChannel(
          context.anearEvent.actionsChannelName,
          context.anearEvent.anearEventMachine
        )
      }
    ),
    createSpectatorsChannel: assign(
      {
        spectatorsDisplayChannel: context => context.realtimeMessaging.getChannel(
          context.anearEvent.spectatorsChannelName,
          context.anearEvent.anearEventMachine
        )
      }
    ),
    enableSpectatorPresenceEvents: (context, event) => {
      // future spectators who (un)attach to the spectatorsDisplayChannel will
      // trigger presence events to the anearEventMachine
      context.realtimeMessaging.enablePresenceCallbacks(
        context.spectatorsDisplayChannel,
        context.anearEvent.anearEventMachine,
        constants.SpectatorPresencePrefix,
        constants.SpectatorPresenceEvents
      )
    },
    enableParticipantPresenceEvents: (context, event) => {
      // future participants who (un)attach to the actionsChannel will
      // trigger presence events to the anearEventMachine
      context.realtimeMessaging.enablePresenceCallbacks(
        context.actionsChannel,
        context.anearEvent.anearEventMachine,
        constants.ParticipantPresencePrefix,
        constants.ParticipantPresenceEvents
      )
    },
    subscribeToActionMessages: context => context.realtimeMessaging.subscribe(
      context.actionsChannel,
      context.anearEvent.anearEventMachine,
      constants.ActionEventName
    ),
    subscribeToEventMessages: context => context.realtimeMessaging.subscribe(
      context.eventChannel,
      context.anearEvent.anearEventMachine
    ),
    createParticipantsDisplayChannel: assign(
      {
        participantsDisplayChannel: context => context.realtimeMessaging.getChannel(
          context.anearEvent.participantsChannelName,
          context.anearEvent.anearEventMachine
        )
      }
    ),
    createEventAppMachine: assign(
      {
        appEventMachine: context => {
          const interpretedService = interpret(context.appEventMachineFactory(context.anearEvent))
          const service = interpretedService.onTransition(MetaViewPathEventProcessing)
          return service.start()
        }
      }
    ),
    startNewParticipantMachine: assign(
      {
        anearParticipantMachines: (context, event) => {
          const participantJSON = event.data
          const anearParticipant = new AnearParticipant(participantJSON)

          anearParticipant.anearParticipantMachine = AnearParticipantMachine(
            anearParticipant,
            event.geoLocation,
            context
          )

          return {
            ...context.anearParticipantMachines,
            [anearParticipant.id]: anearParticipant.anearParticipantMachine.start()
          }
        }
      }
    ),
    sendParticipantEnterToEventAppMachine: (context, event) => {
      const participantJSON = event.data
      context.appEventMachine.send(constants.ParticipantEnterEventName, participantJSON)
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

      anearParticipantMachine.send(constants.ActionEventName, actionEventPayload)
      context.appEventMachine.send(actionEventPayload)
    },
    processParticipantTimeout: (context, event) => context.appEventMachine.send(
      constants.TimeoutEventName,
      { participantId: event.participantId }
    )
  },
  services: {
    publishParticipantsDisplay: (context, event) => {
      return context.realtimeMessaging.publish(
        context.participantsDisplayChannel,
        constants.ParticipantsDisplayEventName,
        event.content
      )
    },
    publishSpectatorsDisplay: (context, event) => context.realtimeMessaging.publish(
      context.spectatorsDisplayChannel,
      constants.SpectatorsDisplayEventName,
      event.content
    ),
    refreshSpectatorView: (context, event) => {
    },
    getAndNotifyAttachedSpectators: (context, event) => {
      return context.realtimeMessaging.getAndNotifyPresenceOnChannel(
        context.spectatorsDisplayChannel,
        context.anearEvent.anearEventMachine,
        SpectatorPresencePrefix
      )
    },
    getAndNotifyAttachedParticipants: (context, event) => {
      return context.realtimeMessaging.getAndNotifyPresenceOnChannel(
        context.actionsChannel,
        context.anearEvent.anearEventMachine,
        ParticipantPresencePrefix
      )
    },
    attachToParticipantsDisplayChannel: async context => {
      return context.realtimeMessaging.attachTo(context.participantsDisplayChannel)
    },
    attachToSpectatorsChannel: async context => {
      return context.realtimeMessaging.attachTo(context.spectatorsDisplayChannel)
    },
    detachChannels: async context => {
      const channels = [
        context.eventChannel,
        context.actionsChannel,
        context.participantsDisplayChannel,
      ]
      if (context.spectatorsDisplayChannel) channels.push(context.spectatorsDisplayChannel)
      await context.realtimeMessaging.detachAll(channels)

      // context.anearParticipantMachines. detach these private channels
    },
    fetchParticipantData: (context, event) => {
      // returns Promise
      return context.anearApi.getEventParticipantJson(event.participantId)
    }
  },
  guards: {
    doesEventAllowSpectators: (context, event) => context.anearEvent.allowsSpectators(),
    isEventHosted: (context, event) => context.anearEvent.hosted
  }
})

const AnearEventMachine = (anearEvent, {
  anearApi,
  cssUrl,
  pugTemplates,
  realtimeMessaging,
  appEventMachineFactory,
  appParticipantMachineFactory
}) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearEventMachineStatesConfig(anearEvent.id)}

  const eventMachine = createMachine(expandedConfig, AnearEventMachineFunctions)

  const anearEventMachineContext = AnearEventMachineContext(
    anearEvent,
    anearApi,
    cssUrl,
    pugTemplates,
    realtimeMessaging,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  return interpret(eventMachine.withContext(anearEventMachineContext))
}

module.exports = AnearEventMachine
