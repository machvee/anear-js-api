"use strict"

const { assign } = require('xstate')
const logger = require('../utils/Logger')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearEvent = require('../models/AnearEvent')
const NumEventChannels = 4

const AnearEventMachineContext = (coreAppMachine, anearEvent) => ({
  coreAppMachine,
  anearEvent,
  attachedCount: 0,
  participantMachines: [],
  appMachine: null // third-party app machine
})

const AttachedEventHandler = contextAttr => ({
  ATTACHED: {
    actions: assign({ attachedCount: (context, event) => context.attachedCount + 1 })
    target: 'waitAllCreated'
  }
})

const CreateChannels = {
  // this parallel state machine enters all 'NumEventChannels' states simultaneously, and 
  // creates realtime messaging channels for each type of comm the event
  // requires.   When each channel sends the ATTACHED event, each parallel
  // state transitions to the waitAllCreated state which waits for all 
  // channels to be set in the context
  createChannels: {
    states: {
      type: 'parallel',
      eventChannel: {
        entry: 'createEventChannel',
        on: AttachedEventHandler('eventChannelMachine')
      },
      actionsChannel: {
        entry: 'createActionsChannel',
        on: AttachedEventHandler('actionsChannelMachine')
      },
      participantsChannel: {
        entry: 'createParticipantsChannel',
        on: AttachedEventHandler('participantsChannelMachine')
      },
      spectatorsChannel: {
        entry: 'createSpectatorsChannel',
        on: AttachedEventHandler('spectatorsChannelMachine')
      }
    },
    waitAllCreated: {
      always: [
        {cond: 'allChannelsAttached', target: 'created'}
      ]
    }
  }
}

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
    PARTICIPANT_JOIN: {
      target: 'participantJoin'
    },
    SPECTATOR_VIEW: {
      target: 'refreshSpectatorView'
    },
    PARTICIPANT_EXIT: {
      target: 'participantExit'
    }
  },
  states: {
    createChannels,
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
      if (context.anearEvent.allowsSpectators()) {
        anearEventMachine.createChannel(context, context.anearEvent.spectatorsChannelName(), 'SPECTATOR')
      } else {
        send('ATTACHED')
      }
    }
  },
  services: {
    updateParticipantDisplay: (context, event) => {

    },
    refreshSpectatorView: (context, event) => {

    },
    refreshAllViews: (context, event) => {

    }
  },
  guards: {
    allChannelsAttached: (context, event) => {
      return (context.attachedCount === NumEventChannels)
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
    const channelParams = {
      channelName,
      parentMachine: this,
      presencePrefix
    }
    context.coreAppMachine.connectionMachine.send('CREATE_CHANNEL', channelParams)
  }
}

module.exports = AnearEventMachine
