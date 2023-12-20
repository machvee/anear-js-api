"use strict"

const { assign } = require('xstate')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearParticipantMachine = require('../state_machines/AnearParticipantMachine')
const AnearEvent = require('../models/AnearEvent')

const AnearEventMachineContext = (realtimeMessaging, anearEvent) => ({
  realtimeMessaging,
  anearEvent,
  eventChannel: null, // event control messages
  actionsChannel: null, // participant presence/live actions
  participantsDisplayChannel: null, // display all participants
  spectatorsDisplayChannel: null, // display all spectators
  participantMachines: {}, // all active/idle participants
  eventAppMachine: null // third-party app machine
})

const CreateChannelsStateConfig = {
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
      always: { target: '#createEventApp' }
    }
  }
}

const CoreEventMachineActiveStateConfig = {
  id: 'active',
  initial: 'created',
  on: {
    CANCEL: {
      target: '#canceled'
    },
    REFRESH: {
      entry: 'refreshParticipantView',
      target: '#active.hist'
    },
    PARTICIPANT_ENTER: {
      // This event triggers the spawning of an AnearParticipantMachine instance. This machine tracks presence,
      // geo-location (when approved by mobile participant), manages active/idle state for long-running events,
      // and manages any ACTION timeouts
      actions: ['createAnearParticipantMachine'],
      target: '#active.hist'
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
        ANNOUNCE: {
          target: 'announce'
        },
        START: {
          target: 'opening'
        }
      }
    },
    announce: {
      on: {
        NEXT: {
          target: 'opening'
        },
        START: {
          target: 'opening'
        },
        ACTION: {
          // Host action
        }
      }
    },
    opening: {
      on: {
        NEXT: {
          target: 'live'
        },
        ACTION: {
          // Host action
        }
      }
    },
    live: {
      on: {
        NEXT: {
          target: 'closing'
        },
        PAUSE: {
          target: 'paused'
        },
        TIMEOUT: {
          target: 'live'
        },
        CLOSE: {
          target: 'closed'
        },
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
        RESUME: {
          target: 'resuming'
        }
      }
    },
    resuming: {
      on: {
        NEXT: {
          target: 'live'
        }
      }
    },
    closing: {
      on: {
        NEXT: {
          target: 'closed'
        }
      }
    },
    closed: {
      entry: 'detachChannels',
      on: {
        NEXT: {
          target: 'review'
        },
        ARCHIVE: {
          target: 'archived'
        }
      }
    },
    review: {
      on: {
        NEXT: {
          target: 'reward'
        }
      }
    },
    reward: {
      on: {
        NEXT: {
          target: 'archived'
        }
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
    refreshSpectatorView: {
      id: 'refreshSpectatorView',
      invoke: {
        src: 'refreshSpectatorView',
        onDone: {
          target: '#active.hist'
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
          target: '#active.hist'
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
    }
  }
}

const AnearEventMachineConfig = ({
  id: 'anearEventMachine',
  initial: 'createChannels',
  states: {
    createChannels: CreateChannelsStateConfig,
    createEventApp: {
      // starts the developer-supplied EventAppMachine
      id: 'createEventApp',
      entry: 'createEventAppMachine',
      always: {
        target: 'active'
      }
    },
    active: CoreEventMachineActiveStateConfig
  }
})

const AnearEventMachineFunctions = anearEventMachine => ({
  actions: {
    createEventChannel: assign(
      {
        eventChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          anearEventMachine,
          context.anearEvent.eventChannelName()
        )
      }
    ),
    createActionsChannel: assign(
      {
        actionsChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          anearEventMachine,
          context.anearEvent.actionsChannelName(),
          'PARTICIPANT'
        )
      }
    ),
    createParticipantsDisplayChannel: assign(
      {
        participantsDisplayChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          anearEventMachine,
          context.anearEvent.participantsChannelName()
        )
      }
    ),
    createSpectatorsChannel: assign(
      {
        spectatorsChannel: context => anearEventMachine.createChannel(
          context.realtimeMessaging,
          anearEventMachine,
          context.anearEvent.spectatorsChannelName(),
          'SPECTATOR'
        )
      }
    ),
    createEventAppMachine: assign({ eventAppMachine: (context, event) => anearEventMachine.createEventAppMachine(context)}),
    createAnearParticipantMachine: (context, event) => {
      const participantJSON = JSON.parse(event.member.data)
      const participantId = participantJSON.data.id
      const machine = new AnearParticipantMachine(anearEventMachine, participantJSON)

      assign({
        participantMachines: {
          ...context.participantMachines,
          [participantId]: machine
        }
      })
      machine.startService()
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
  constructor(realtimeMessaging, eventJSON) {
    super(
      AnearEventMachineConfig,
      AnearEventMachineFunctions,
      AnearEventMachineContext(realtimeMessaging, new AnearEvent(eventJSON))
    )
  }

  createChannel(realtimeMessaging, parentMachine, channelName, presencePrefix = null) {
    return realtimeMessaging.getChannel(channelName, parentMachine, { presencePrefix })
  }

  createEventAppMachine(context) {
    const machine = this.eventAppMachineInstance(context)
    machine.startService()
    return machine
  }

  eventAppMachineInstance(context) {
    const { AppEventMachineClass } = context.coreServiceMachine.context
    return new AppEventMachineClass(this)
  }

  participantEventMachineInstance(anearParticipantMachine) {
    const { ParticipantEventMachineClass } = this.context.coreServiceMachine.context
    return new ParticipantEventMachineClass(anearParticipantMachine)
  }

  findParticipant(context, participantId) {
    return context.participantMachines[participantId]
  }
}

module.exports = AnearEventMachine
