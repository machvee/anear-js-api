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
  pugTemplates,
  realtimeMessaging,
  appEventMachineFactory,
  appParticipantMachineFactory
) => (
  {
    anearEvent,
    anearApi,
    pugTemplates,
    ...AnearEventChannels,
    anearParticipantMachines: {}, // all active/idle participant child machines
    appEventMachineFactory,
    appParticipantMachineFactory,
    appEventMachine: null, // third-party app spawned child machine
    realtimeMessaging
  }
)

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
            target: 'createAppEventMachine'
          }
        ]
      }
    },
    createAttachToSpectatorsChannel: {
      entry: 'createSpectatorsChannel',
      on: {
        ATTACHED: 'createAppEventMachine' // spectatorsDisplayChannel ATTACHED
      },
      invoke: {
        src: 'attachToSpectatorsChannel',
        onDone: {
          target: 'createAttachToSpectatorsChannel',
          internal: true
        },
        onError: {
          target: '#failure'
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

const MobileBrowserEventConfig = {
  //
  // AnearEventMachine handles these raw, mobile client-based events
  // and forwards as needed to the AppEventMachine and/or AnearParticipantMachine
  //
  CANCEL: '#canceled', // client cancelled out of an event
  REFRESH: {
    // (who sends this? outdated?) occurs when a participant leaves, then immediately re-enters an event.  Often triggered
    // when the client device drops then re-establishes their network connection or
    // reloads the event page in mobile browser
    entry: 'refreshParticipantView',
    target: '#activeEvent.hist'
  },
  PARTICIPANT_ENTER: {
    // Presence event. This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
    // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
    // and manages any ACTION timeouts
    target: '#fetchParticipantData'
  },
  SPECTATOR_ENTER: {
    target: '#spectatorEnter'
  },
  PARTICIPANT_LEAVE: {
    // Presence event. Ably drops the mobile browser connection, and doesn't immediately re-establish connection
    target: '#participantExit'
  },
  PARTICIPANT_UPDATE: {
    // Presence event. Not currently implemented in Anear Browser App, but the future use-case
    // is that apps will be configured to send these perodically (user's will have granted
    // the app permission) so the app can have up-to-date user geo-location
    actions: ['updateParticipantPresence'],
    target: '#activeEvent.hist'
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
  PARTICIPANTS_DISPLAY: {
    // sent by MetaViewPathEventProcessing when a meta view is detected in a state
    // being transitioned to
    target: '#participantsDisplay'
  },
  SPECTATORS_DISPLAY: {
    // sent by MetaViewPathEventProcessing when a meta view is detected in a state
    // being transitioned to
    target: '#spectatorsDisplay'
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
  initial: 'created',
  on: MobileBrowserEventConfig,

  states: {
    created: {
      initial: 'eventCreatorPresence',
      on: {
        ANNOUNCE: {
          // for event hosts to allow spectators to join
          target: '#activeEvent.announcing'
        },
        START: {
          // for event creator/participants to get event started
          actions: ['enableSpectatorPresenceEvents'],
          invoke: {
            src: 'getAndNotifyAttachedSpectators',
            onDone: {
              target: '#activeEvent.opening'
            },
            onError: {
              target: '#failure'
            }
          }
        }
      },
      states: {
        eventCreatorPresence: {
          // this will let the AppEventMachine know that the event creator
          // has attached, or will soon attach
          entry: ['enableParticipantPresenceEvents'],
          invoke: {
            src: 'getAndNotifyAttachedParticipants',
            onDone: [
              {
                // if the event is hosted, the creator is someone
                // who won't generallyl be an active participant, they
                // are more like an emcee, or the merchant setting up
                // and event for on-premise patrons
                cond: 'eventCreatorIsHost',
                target: '#activeEvent.created'
              },
              {
                // auto-transition to announcing if the
                // event creator is a participant so others
                // (spectators) may view or join
                target: '#activeEvent.announcing'
              }
            ],
            onError: {
              target: '#failure'
            }
          }
        }
      }
    },
    announcing: {
      // this will let the AppEventMachine know which spectators may
      // already be attached, or will soon attach
      entry: ['enableSpectatorPresenceEvents'],
      invoke: {
        src: 'getAndNotifyAttachedSpectators',
        onDone: {
          target: 'announce'  // Proceed to 'announce' once done
        },
        onError: {
          target: '#failure'
        }
      }
    },
    announce: {
      on: {
        NEXT: 'opening',
        START: 'live',
      }
    },
    opening: {
      // opportunity for app developers to
      // give participants a display update 'heads-up' that
      // the event is starting, for those participants who
      // may have been waiting for a quorum
      on: {
        NEXT: 'live',
      }
    },
    live: {
      // all participants have joined and the game 
      // is now in progress
      entry: ['notifyParticipantsLive'],
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
          actions: ['startNewParticipantMachine', 'sendParticipantEnterToAppEventMachine'],
          target: '#activeEvent.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    spectatorEnter: {
      id: 'spectatorEnter',
      entry: ['sendSpectatorEnterToAppEventMachine'],
      always: {
        target: '#activeEvent.hist'
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
    createEventChannels: CreateEventChannelsAndAppMachineConfig,
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
    createAppEventMachine: assign(
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
    sendSpectatorEnterToAppEventMachine: (context, event) => {
      const userJSON = event.data
      context.appEventMachine.send(constants.SpectatorEnterEventName, userJSON)
    },
    sendParticipantEnterToAppEventMachine: (context, event) => {
      const participantJSON = event.data
      context.appEventMachine.send(constants.ParticipantEnterEventName, participantJSON)
    },
    updateParticipantPresence: (context, event) => {
      // lookup the anearParticipantMachine and update their context
    },
    sendLiveToParticipantMachines: (context, event) => {
      for (const participantMachine in context.anearParticipantMachines) {
        participantMachine.send(constants.StartEventName)
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
        constants.ParticipantPresencePrefix
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
    },
    fetchParticipantData: (context, event) => {
      // event.data => {id: <participantId>, geoLocation: {}}
      // returns Promise
      return context.anearApi.getEventParticipantJson(event.data.id)
    }
  },
  guards: {
    doesEventAllowSpectators: (context, event) => context.anearEvent.allowsSpectators(),
    eventCreatorIsHost: (context, event) => context.anearEvent.hosted,
  }
})

const AnearEventMachine = (anearEvent, {
  anearApi,
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
    pugTemplates,
    realtimeMessaging,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  return interpret(eventMachine.withContext(anearEventMachineContext))
}

module.exports = AnearEventMachine
