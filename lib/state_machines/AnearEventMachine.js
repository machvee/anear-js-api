"use strict"

const { assign } = require('xstate')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')

const AnearEventMachineContext = (anearEvent, realtimeMessaging, AppEventMachineClass) => ({
  realtimeMessaging,
  anearEvent,
  eventChannel: null, // event control messages
  actionsChannel: null, // participant presence/live actions
  participantsDisplayChannel: null, // display all participants
  spectatorsDisplayChannel: null, // display all spectators
  participantMachines: {}, // all active/idle participant child machines
  AppEventMachineClass,
  eventAppMachine: null // third-party app spawned child machine
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
    CANCEL: {
      target: '#canceled'
    },
    REFRESH: {
      entry: 'refreshParticipantView',
      target: '#activeEvent.hist'
    },
    PARTICIPANT_ENTER: {
      // This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
      // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
      // and manages any ACTION timeouts
      actions: ['createAnearParticipantMachine'],
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
      // these events come from the AppEventMachine as it is moves through it's event flow
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

const AnearEventMachineConfig = anearEvent => ({
  id: `anearEventMachine_${anearEvent.id}`,
  initial: 'createEventChannels',
  states: {
    createEventChannels: CreateEventChannelStates,
    createEventApp: CreateEventAppStates,
    activeEvent: ActiveEventStates
  }
})

const AnearEventMachineFunctions = anearEventMachine => ({
  actions: {
    createEventChannel: assign(
      {
        eventChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          context.anearEvent.eventChannelName()
        )
      }
    ),
    createActionsChannel: assign(
      {
        actionsChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          context.anearEvent.actionsChannelName(),
          'PARTICIPANT'
        )
      }
    ),
    createParticipantsDisplayChannel: assign(
      {
        participantsDisplayChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          context.anearEvent.participantsChannelName()
        )
      }
    ),
    createSpectatorsChannel: assign(
      {
        spectatorsChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          context.anearEvent.spectatorsChannelName(),
          'SPECTATOR'
        )
      }
    ),
    createEventAppMachine: assign(
      {
        eventAppMachine: context => anearEventMachine.createEventAppMachine(context)
      }
    ),
    createAnearParticipantMachine: (context, event) => {
      const participantJSON = JSON.parse(event.member.data)
      const participantId = participantJSON.data.id
      const machine = new AnearParticipantMachine(anearEventMachine, participantJSON)

      machine.startService()

      return assign({
        participantMachines: {
          ...context.participantMachines,
          [participantId]: machine
        }
      })
    },
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

class AnearEventMachine extends AnearBaseMachine {
  constructor(anearEvent, realtimeMessaging, AppEventMachineClass) {
    super(
      AnearEventMachineConfig(anearEvent),
      AnearEventMachineFunctions,
      AnearEventMachineContext(anearEvent, realtimeMessaging, AppEventMachineClass)
    )
  }

  createChannel(realtimeMessaging, channelName, presencePrefix = null) {
    return realtimeMessaging.getChannel(channelName, this, { presencePrefix })
  }

  createEventAppMachine(context) {
    const appEventMachine = new context.AppEventMachineClass(this, context.anearEvent)
    appEventMachine.spawnChildService()
    return appEventMachine
  }

  participantEventMachineInstance(context, anearParticipantMachine) {
    // REWORK THIS let the App Developer create his own ParticipantEventMachineClass
    const { ParticipantEventMachineClass } = this.context.coreServiceMachine.context
    return new ParticipantEventMachineClass(anearParticipantMachine)
  }

  findParticipant(context, participantId) {
    return context.participantMachines[participantId]
  }
}

module.exports = AnearEventMachine
