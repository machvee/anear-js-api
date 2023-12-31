"use strict"

const { assign, createMachine, interpret } = require('xstate')

const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')
const AnearParticipant = require('../models/AnearParticipant')

const ParticipantPresencePrefix = 'PARTICIPANT'
const SpectatorPresencePrefix = 'SPECTATOR'
const SpectatorPresenceEvents = ['enter', 'leave']
const ActionEventName = 'ACTION'

const AnearEventChannels = {
  eventChannel: null,   // event control messages
  actionsChannel: null, // participant presence/live actions
  participantsDisplayChannel: null, // display all participants
  spectatorsDisplayChannel: null    // display all spectators
}

const AnearEventMachineContext = (anearEvent, realtimeMessaging, appEventMachineFactory) => ({
  anearEvent,
  ...AnearEventChannels,
  participantMachines: {}, // all active/idle participant child machines
  appEventMachineFactory,
  eventAppMachine: null, // third-party app spawned child machine
  realtimeMessaging
})

const CreateEventChannelsStates = {
  id: 'createChannels',
  initial: 'eventChannel',
  states: {
    eventChannel: {
      entry: 'createEventChannel',
      always: {
        target: 'subscribeEventMessages'
      }
    },
    subscribeEventMessages: {
      entry: 'subscribeToEventMessages',
      on: {
        ATTACHED: 'actionsChannel',
      }
    },
    actionsChannel: {
      entry: 'createActionsChannel',
      on: {
        ATTACHED: 'subscribeActionMessages',
      }
    },
    subscribeActionMessages: {
      entry: 'subscribeToActionMessages',
      always: {
        target: 'participantsDisplayChannel'
      }
    },
    participantsDisplayChannel: {
      entry: 'createParticipantsDisplayChannel',
      always: [
        {
          target: 'spectatorsChannel',
          cond: 'allowsSpectators'
        },
        {
          target: '#createEventApp'
        }
      ]
    },
    spectatorsChannel: {
      entry: 'createSpectatorsChannel',
      on: {
        ATTACHED: '#createEventApp'
      }
    }
  }
}

const CreateEventAppStates = {
  id: 'createEventApp',
  entry: 'createEventAppMachine',
  always: {
    target: 'activeEvent'
  }
}

const ActiveEventStates = {
  id: 'activeEvent',
  initial: 'created',
  on: {
    CANCEL: '#canceled',
    REFRESH: {
      entry: 'refreshParticipantView',
      target: '#activeEvent.hist'
    },
    PARTICIPANT_ENTER: {
      // This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
      // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
      // and manages any ACTION timeouts
      actions: ['startNewParticipantMachine'],
      target: '#activeEvent.hist'
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
    [ActionEventName]: {
      // Participant/Host ACTION.  Host ACTIONs can arrive during creeated/opening states
      // Route to AnearParticipantMachine to update participant state
      //
      actions: ['processParticipantAction'],
      target: '#activeEvent.hist'
    },
    PARTICIPANT_TIMEOUT: {
      actions: ['processParticipantTimeout'],
      target: '#activeEvent.hist'
    }
  },
  states: {
    created: {
      // these events come from the appEventMachine as it is moves through it's event flow
      on: {
        ANNOUNCE: 'announce',
        START: 'opening'
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
    refreshAllViews: {
      invoke: {
        src: 'refreshAllViews',
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

const AnearEventMachineConfig = id => ({
  id: `anearEventMachine_${id}`,
  initial: 'createEventChannels',
  states: {
    createEventChannels: CreateEventChannelsStates,
    createEventApp: CreateEventAppStates,
    activeEvent: ActiveEventStates
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
          context.anearEvent.anearEventMachine,
          {
            presencePrefix: ParticipantPresencePrefix
          }
        )
      }
    ),
    subscribeToActionMessages: context => context.realtimeMessaging.subscribe(
      context.actionsChannel,
      context.anearEvent.anearEventMachine,
      ActionEventName
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
    createSpectatorsChannel: assign(
      {
        spectatorsChannel: context => context.realtimeMessaging.getChannel(
          context.anearEvent.spectatorsChannelName,
          context.anearEvent.anearEventMachine,
          {
            presencePrefix: SpectatorPresencePrefix,
            presenceEvents: SpectatorPresenceEvents
          }
        )
      }
    ),
    createEventAppMachine: assign(
      {
        eventAppMachine: context => interpret(context.appEventMachineFactory(context.anearEvent)).start()
      }
    ),
    startNewParticipantMachine: assign(
      {
        participantMachines: (context, event) => {
          const participantJSON = JSON.parse(event.member.data)
          const participantId = participantJSON.data.id
          const anearParticipant = new AnearParticipant(participantJSON)

          anearParticipant.anearParticipantMachine = AnearParticipantMachine(anearParticipant, context)

          return {
            ...context.participantMachines,
            [participantId]: anearParticipant.anearParticipantMachine.start()
          }
        }
      }
    ),
    updateParticipantPresence: (context, event) => {
      // lookup the participantMachine and update their context
    },
    processParticipantAction: (context, event) => {
      // event.payload: {"eventAppMachine ACTION": {action event keys and values}}
      // send to the ParticipantMachine to handle state of participant (idle, turn off timer etc)
      const participantId = event.message.data.participantId
      const eventMessagePayload = JSON.parse(event.message.data.payload) // { eventName: {eventObject} }
      const participantMachine = context.participantMachines[participantId]
      const [eventName, payload] = Object.entries(eventMessagePayload)[0]

      const actionEvent = {
        type: eventName,
        participantId,
        payload
      }

      participantMachine.send(actionEvent)
      context.eventAppMachine.send(actionEvent)
    },
    updateParticipantDisplay: (context, event) => {
      // based on the appMachine.context.state.value, find the
      // view in a directory, and generate the HTML from the pug template
      // and publish this to the participant
      const htmlMessage = context.anearEvent.generateView(context.appMachine.context, event)
      const participantMachine = context.anearEvent.anearEventMachine.findParticipant(event.participantId)
      participantMachine.publish(htmlMessage)
    }
  },
  services: {
    refreshSpectatorView: (context, event) => {
    },
    refreshAllViews: (context, event) => {
    },
    detachChannels: async context => {
      const channels = [
        context.eventChannel,
        context.actionsChannel,
        context.participantsDisplayChannel,
      ]
      if (context.spectatorsChannel) channels.push(context.spectatorsChannel)
      await context.realtimeMessaging.detachAll(channels)

      // context.participantMachines. detach these private channels
    }
  },
  guards: {
    allowsSpectators: (context, event) => context.anearEvent.allowsSpectators()
  }
})

const AnearEventMachine = (anearEvent, { realtimeMessaging, appEventMachineFactory }) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearEventMachineConfig(anearEvent.id)}

  const eventMachine = createMachine(expandedConfig, AnearEventMachineFunctions)

  const anearEventMachineContext = AnearEventMachineContext(
    anearEvent,
    realtimeMessaging,
    appEventMachineFactory
  )

  return interpret(eventMachine.withContext(anearEventMachineContext))
}

module.exports = AnearEventMachine
