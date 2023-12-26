"use strict"

const { assign, createMachine } = require('xstate')

const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')
const AnearParticipant = require('../models/AnearParticipant')

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

const CreateEventChannelStates = {
  id: 'createChannels',
  initial: 'eventChannel',
  states: {
    eventChannel: {
      entry: 'createEventChannel',
      always: {
        target: 'actionsChannel'
      }
    },
    actionsChannel: {
      entry: 'createActionsChannel',
      on: {
        ATTACHED: 'participantsDisplayChannel'
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
    SPECTATOR_ENTER: {
      target: '#refreshSpectatorView'
    },
    SPECTATOR_LEAVE: {
      target: '#spectatorExit'
    },
    PARTICIPANT_LEAVE: {
      target: '#participantExit'
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
        ACTION: {} // Host action
      }
    },
    opening: {
      on: {
        NEXT: 'live',
        ACTION: {} // Host action
      }
    },
    live: {
      on: {
        NEXT: 'closing',
        PAUSE: 'paused',
        TIMEOUT: 'live',
        CLOSE: 'closed',
        ACTION: {
          // Participant Action
          //   Route to AnearParticipantMachine to update participant state
          // Maybe we need a higher level ACTION event that gets encoded into the display, and a sub-event
          // is part of the payload:  e.g.  ACTION: {MOVE: {x: 1, y: 0}}.   The sub-event MOVE is routed to the
          // AnearAppEventMachine and the ACTION is sent to the participantMachine for the sending participant
          // to engage the ParticipantTimer
          //   event.participantId
          //   event.payload => {actionMessageType: {actionObjectData}}
          //
          actions: ['processParticipantAction']
        }
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
    createEventChannels: CreateEventChannelStates,
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
          { presencePrefix: 'PARTICIPANT' }
        )
      }
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
          { presencePrefix: 'SPECTATOR' }
        )
      }
    ),
    createEventAppMachine: assign(
      {
        eventAppMachine: context => context.appEventMachineFactory(context.anearEvent).start()
      }
    ),
    startNewParticipantMachine: assign(
      {
        participantMachines: (context, event) => {
          const participantJSON = JSON.parse(event.member.data)
          const participantId = participantJSON.data.id
          const anearParticipant = new AnearParticipant(participantJSON)

          anearParticipant.anearParticipantMachine = AnearParticipantMachine(
            context.anearEvent,
            anearParticipant,
            context.realtimeMessaging
          )

          return {
            ...context.participantMachines,
            [participantId]: anearParticipant.anearParticipantMachine.start()
          }
        }
      }
    ),
    processParticipantAction: (context, event) => {
      // send to the ParticipantMachine to handle state of participant (idle, turn off timer etc)
      const participantMachine = anearEventMachine.findParticipant(event.participantId)
      participantMachine.send(event.type, event.payload)
      //YOU ARE HERE send to Developer App Machine now?
    },
    updateParticipantDisplay: (context, event) => {
      // based on the appMachine.context.state.value, find the
      // view in a directory, and generate the HTML from the pug template
      // and publish this to the participant
      const htmlMessage = context.anearEvent.generateView(context.appMachine.context, event)
      const participantMachine = anearEventMachine.findParticipant(event.participantId)
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

const AnearEventMachine = (anearEvent, realtimeMessaging, appEventMachineFactory) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearEventMachineConfig(anearEvent.id)}

  const eventMachine = createMachine(expandedConfig, AnearCoreServiceMachineFunctions)

  const ctx = AnearEventMachineContext(
    anearEvent,
    realtimeMessaging,
    appEventMachineFactory
  )

  return eventMachine.withContext(ctx)
}

module.exports = AnearEventMachine
