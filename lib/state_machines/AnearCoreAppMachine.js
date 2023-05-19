"use strict"

// The AnearCoreAppMachine is the highest parent in the hierarchy of the
// AnearService HSM.   It is responsible for the realtime-messaging (ably.io)
// Connection, and all AnearEventMachines spawned for each request to run
// an AnearEvent.   The developer provides their App and Participant StateMachine
// classes via the Anearservice

const { createMachine, interpret, assign } = require('xstate')
const logger = require('../utils/Logger')
const AnearEventMachine = require('../state_machines/AnearEventMachine')
const ConnectionMachine = require('../state_machines/ConnectionMachine')

const AnearCoreAppMachineContext = (appId, anearApi, AppStateMachine, ParticipantStateMachine) => ({
  appId: appId,
  appData: null,
  AppStateMachine,
  ParticipantStateMachine,
  connectionMachine: null,
  createNewEventChannelMachine: null,
  anearEventMachines: {},
  anearApi
})

const AnearCoreAppMachineConfig = {
  id: 'AnearCoreAppMachine',
  initial: 'fetchAppData',
  on: {
    update: 'hist'
  },
  states: {
    fetchAppData: {
      invoke: {
        src: 'fetchAppData',
        onDone: {
          actions: assign({ appData: (context, event) => event.data })
          target: 'startConnectionMachine'
        },
        onError: {
          target: 'sleepRetryFetchAppData'
        }
      }
    },
    startConnectionMachine: {
      entry: 'startConnectionMachine',
      on: {
        CONNECTED: {
          target: 'buildCreateEventsChannel'
        }
      }
    },
    buildCreateEventsChannel: {
      entry: 'ensureCreateEventsChannel',
      on: {
        ATTACHED: {
          actions: assign({ createNewEventChannelMachine: (context, event) => event.data }) // event.data is the machine
          target: 'subscribeCreateEventMessages'
        }
      }
    },
    subscribeCreateEventMessages: {
      invoke: {
        src: 'subscribeCreateEventMessages',
        onDone: {
          target: 'waitAnearEventLifecycleCommand'
        },
        onError: {
          target: 'failed'
        }
      }
    },
    waitAnearEventLifecycleCommand: {
      on: {
        CREATE_EVENT: {
          actions: ['startNewEventMachine']
        },
        REMOVE_EVENT: { actions: ['removeEvent']
        }
      }
    },
    sleepRetryFetchAppData: {
      // sleep and retry with backoff, the back to fetchApp
    },
    hist: {
      // used to transition back to child state if/when a participant REFRESH
      // or SPECTATOR_VIEW event occurs
      type: 'history',
      history: 'shallow'
    },
    failed: {
      type: 'final'
    }
  }
}

const AnearCoreAppMachineFunctions = coreAppMachine => ({
  services: {
    fetchAppData: (context, event) => context.anearApi.getApp(context.appId),
    subscribeCreateEventMessage: (context, event) => {
      return context.createNewEventChannelMachine.subscribe('CREATE_EVENT')
    }
  },
  actions: {
    startConnectionMachine: (context, event) => {
      const machine = new ConnectionMachine(coreAppMachine)
      return assign({ connectionMachine: (context, event) => machine })
    },
    ensureCreateEventChannel: (context, event) => {
      // Send a 'CREATE_CHANNEL' event with params to the ConnectionMachine
      // which should Create a Channel Machine with parentMachine 'coreAppMachine'
      // so Channel Machine can call:
      //   parentMachine.send('ATTACHED', { channelMachine: channelMachine })
      //   parentMachine.send('CREATE_EVENT', {message: message})
      const createChannelEventParams = {
        channelName: coreAppMachine.createNewEventChannelName(context.appId),
        parentMachine: coreAppMachine
      }
      context.connectionMachine.send('CREATE_CHANNEL', createChannelEventParams)
    },
    startNewEventMachine: (context, event) => {
      // create a new anearEventMachine and pass it coreAppMachine so it can send events
      // back to this AppMachine, like REMOVE_EVENT.  The AnearEventMachine will
      // also have access coreAppMachine.context.connectionMachine so it can send it
      // CREATE_CHANNEL events for each event channel it needs
      const eventJSON = JSON.parse(message.data)
      const anearEventId = eventJSON.data.id
      const machine = new AnearEventMachine(coreAppMachine, eventJSON)

      assign({
        anearEventMachines: {
          ...context.anearEventMachines,
          [anearEventId]: machine
        }
      })
      machine.startService() // new AnearEvent started here!!
    }
  }
})

class AnearCoreAppMachine extends AnearBaseMachine {
  constructor(appId, anearApi, AppStateMachine, ParticipantStateMachine) {
    super(
      AnearCoreAppMachineConfig,
      AnearCoreAppMachineFunctions,
      AnearCoreAppMachineContext(appId, anearApi, AppStateMachine, ParticipantStateMachine)
    )
  }

  createNewEventChannelName(appId) {
    return `anear:${appId}:e`,
  }
}

module.exports = AnearCoreAppMachine
