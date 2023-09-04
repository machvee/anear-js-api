"use strict"

const { assign } = require('xstate')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearEvent = require('../models/AnearEvent')

const AnearEventMachineContext = (coreServiceMachine, anearEvent) => ({
  coreServiceMachine,
  anearEvent,
  eventChannelMachine: null,
  actionsChannelMachine: null,
  participantsChannelMachine: null,
  spectatorsChannelMachine: null,
  participantMachines: [],
  appMachine: null // third-party app machine
})


const AnearEventMachineConfig = ({
  id: 'anearEventMachine',
  initial: 'createChannels',
  states: {
    createChannels: {
      initial: 'eventChannel',
      states: {
        eventChannel: {
          entry: 'createEventChannel',
          on: {
            INITIALIZED: {
              actions: assign({ eventChannelMachine: (context, event) => event.channelMachine }),
            },
            ATTACHED: {
              target: 'actionsChannel'
            }
          }
        },
        actionsChannel: {
          entry: 'createActionsChannel',
          on: {
            INITIALIZED: {
              actions: assign({ actionsChannelMachine: (context, event) => event.channelMachine }),
            },
            ATTACHED: {
              target: 'participantsChannel'
            }
          }
        },
        participantsChannel: {
          entry: 'createParticipantsChannel',
          on: {
            INITIALIZED: {
              actions: assign({ participantsChannelMachine: (context, event) => event.channelMachine }),
            },
            ATTACHED: [
              { cond: 'allowsSpectators', target: 'spectatorsChannel' },
              { target: '#createApp' }
            ]
          }
        },
        spectatatorsChannel: {
          entry: 'createSpectatorsChannel',
          on: {
            INITIALIZED: {
              actions: assign({ spectatorsChannelMachine: (context, event) => event.channelMachine }),
            },
            ATTACHED: {
              target: '#createApp'
            }
          }
        }
      }
    },
    createApp: {
      id: 'createApp',
      entry: 'createAppMachine',
      always: {target: 'active'}
    },
    active: {
      id: 'active',
      initial: 'created',
      on: {
        CANCEL: {
          target: 'canceled'
        },
        REFRESH: {
          entry: 'refreshParticipantView',
          target: '#active.hist'
        },
        PARTICIPANT_ENTER: {
          // YOU ARE HERE Process these participant joins and create AnearParticipantMachines that
          // have context that track geo-location, active/idle state, and action timeouts
          // The AnearParticipantMachine has a private connection and private display messages get published here
          // The AnearParticipantMachine spawns the ParticipantMachine, which is develop supplied, and holds context and
          // state transitions for individual event participants.   When a participant clicks on an ACTION, that Action event
          // travels from the AnearEvent to the AnearParticipant and to the ParticipantMachine.    It is up to the ParticipantMachine
          // to send an event to the AppMachine (e.g. player 'X' moves to (1,2)).
          // ----
          actions: 'createAnearParticipantMachine',
          target: '#active.hist'
        },
        SPECTATOR_ENTER: {
          target: 'refreshSpectatorView'
        },
        SPECTATOR_LEAVE: {
          target: 'spectatorExit'
        },
        PARTICIPANT_LEAVE: {
          target: 'participantExit'
        }
      },
      states: {
        created: {
          // these events come from the appMachine as it is moves through
          // it's event flow
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
            }
          }
        },
        opening: {
          on: {
            NEXT: {
              target: 'live'
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
              target: 'refresh'
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
          entry: 'detachChannels',
          type: 'final'
        },
        refreshSpectatorView: {
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
  }
})

const AnearEventMachineFunctions = anearEventMachine => ({
  actions: {
    createEventChannel: (context, event) => {
      anearEventMachine.createChannel(context, anearEventMachine, context.anearEvent.eventChannelName())
    },
    createActionsChannel: (context, event) => {
      anearEventMachine.createChannel(context, anearEventMachine, context.anearEvent.actionsChannelName(), 'PARTICIPANT')
    },
    createParticipantsChannel: (context, event) => {
      anearEventMachine.createChannel(context, anearEventMachine, context.anearEvent.participantsChannelName())
    },
    createSpectatorsChannel: (context, event) => {
      anearEventMachine.createChannel(context, anearEventMachine, context.anearEvent.spectatorsChannelName(), 'SPECTATOR')
    },
    createAppMachine: assign({ appMachine: (context, event) => anearEventMachine.createAppMachine(context)}),
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
    updateParticipantDisplay: (context, event) => {
      // based on the appMachine.context.state.value, find the
      // view in a directory, and generate the HTML from the pug template
      // and publish this to the participant
      const htmlMessage = context.anearEvent.generateView(context.appMachine.context, event)
      const participantMachine = context.participantMachines[event.participantId]
      participantMachine.publish(htmlMessage)
    }
  },
  services: {
    refreshSpectatorView: (context, event) => {
    },
    refreshAllViews: (context, event) => {

    }
  },
  guards: {
    'allowsSpectators': (context, event) => context.anearEvent.allowsSpectators()
  }
})

class AnearEventMachine extends AnearBaseMachine {
  constructor(coreServiceMachine, eventJSON) {
    super(
      AnearEventMachineConfig,
      AnearEventMachineFunctions,
      AnearEventMachineContext(coreServiceMachine, new AnearEvent(eventJSON))
    )
  }

  createChannel(context, parentMachine, channelName, presencePrefix = null) {
    const { connectionMachine } = context.coreServiceMachine.context
    const channelParams = {
      parentMachine,
      channelName,
      presencePrefix
    }
    connectionMachine.send('CREATE_CHANNEL', channelParams)
  }

  createAppMachine(context) {
    const appMachine = this.appStateMachineInstance(context)
    appMachine.startService()
    return appMachine
  }

  appStateMachineInstance(context) {
    const {AppStateMachineClass} = context.coreServiceMachine.context
    return new AppStateMachineClass(this)
  }

  participantStateMachineInstance(anearParticipantMachine) {
    const {ParticipantStateMachineClass} = this.context.coreServiceMachine.context
    return new ParticipantStateMachineClass(anearParticipantMachine)
  }
}

module.exports = AnearEventMachine
