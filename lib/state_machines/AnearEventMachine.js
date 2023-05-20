"use strict"

const { assign } = require('xstate')
const logger = require('../utils/Logger')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearEvent = require('../models/AnearEvent')

const AnearEventMachineContext = (coreAppMachine, anearEvent) => ({
  coreAppMachine,
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
  on: {
    CANCEL: {
      target: 'canceled'
    },
    REFRESH: {
      target: 'refreshParticipantView'
    },
    PARTICIPANT_ENTER: {
      target: 'participantJoin'
    },
    SPECTATOR_ENTER: {
      target: 'refreshSpectatorView'
    },
    PARTICIPANT_LEAVE: {
      target: 'participantExit'
    }
  },
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
              { target: 'spectatorsChannel', cond: (context, event) => context.anearEvent.allowsSpectators() },
              { target: 'created' }
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
              target: 'created'
            }
          }
        }
      }
    },
    created: {
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
      entry: ['detachChannels'],
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
      entry: ['detachChannels'],
      type: 'final'
    },
    hist: {
      // used to transition back to child state if/when a participant REFRESH
      // or SPECTATOR_VIEW event occurs
      type: 'history',
      history: 'shallow'
    },
    refreshParticipantView: {
      invoke: {
        src: 'updateParticipantDisplay',
        onDone: {
          target: '#anear.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    },
    refreshSpectatorView: {
      invoke: {
        src: 'refreshSpectatorView',
        onDone: {
          target: '#anear.hist'
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
          target: '#anear.hist'
        },
        onError: {
          target: '#failure'
        }
      }
    }
  }
})

class AnearEventMachineFunctions = anearEventMachine => ({
  actions: {
    createEventChannel: (context, event) => {
      anearEventMachine.createChannel(context, context.anearEvent.eventChannelName())
    },
    createActionsChannel: (context, event) => {
      anearEventMachine.createChannel(context, context.anearEvent.actionsChannelName(), 'PARTICIPANT')
    },
    createParticipantsChannel: (context, event) => {
      anearEventMachine.createChannel(context, context.anearEvent.participantsChannelName())
    },
    createSpectatorsChannel: (context, event) => {
      anearEventMachine.createChannel(context, context.anearEvent.spectatorsChannelName(), 'SPECTATOR')
    }
  },
  services: {
    updateParticipantDisplay: (context, event) => {

    },
    refreshSpectatorView: (context, event) => {

    },
    refreshAllViews: (context, event) => {

    }
  }
})

class AnearEventMachine extends AnearBaseMachine {
  constructor(coreAppMachine, eventJSON) {
    super(
      AnearEventMachineConfig,
      AnearEventMachineFunctions,
      AnearEventMachineContext(coreAppMachine, new AnearEvent(eventJSON))
    )
  }

  createChannel(context, channelName, presencePrefix = null) {
    const { connectionMachine } = context.coreAppMachine.context
    const channelParams = {
      parentMachine: this,
      channelName,
      presencePrefix
    }
    connectionMachine.send('CREATE_CHANNEL', channelParams)
  }
}

module.exports = AnearEventMachine
