"use strict"

// The AnearCoreServiceMachine is the highest parent in the hierarchy of the
// AnearService HSM.   It is responsible for the realtime-messaging (ably.io)
// Connection, and all AnearEventMachines spawned for each request to run
// an AnearEvent.   The developer provides their App and Participant StateMachine
// classes via the Anearservice

const { assign } = require('xstate')
const logger = require('../utils/Logger')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearEventMachine = require('../state_machines/AnearEventMachine')
const ConnectionMachine = require('../state_machines/ConnectionMachine')

const AnearCoreServiceMachineContext = (appId, anearApi, AppStateMachineClass, ParticipantStateMachineClass) => ({
  appId: appId,
  appData: null,
  AppStateMachineClass,
  ParticipantStateMachineClass,
  connectionMachine: null,
  createNewEventChannelMachine: null,
  anearEventMachines: {},
  anearApi
})

const AnearCoreServiceMachineConfig = {
  id: 'AnearCoreServiceMachine',
  initial: 'fetchAppData',
  states: {
    fetchAppData: {
      invoke: {
        src: 'fetchAppData',
        onDone: {
          actions: ['setAppData', 'startConnectionMachine'],
          target: 'waitConnected'
        },
        onError: {
          target: 'sleepRetryFetchAppData'
        }
      }
    },
    waitConnected: {
      on: {
        CONNECTED: {
          target: 'createCreateEventsChannel'
        }
      }
    },
    createCreateEventsChannel: {
      entry: 'createCreateEventsChannel',
      on: {
        INITIALIZED: {
          actions: 'setChannel'
        },
        ATTACHED: {
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
          actions: 'startNewEventMachine'
        },
        REMOVE_EVENT: {
          actions: 'removeEvent'
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

const AnearCoreServiceMachineFunctions = coreServiceMachine => ({
  services: {
    fetchAppData: (context, event) => context.anearApi.getApp(context.appId),
    subscribeCreateEventMessage: (context, event) => {
      return context.createNewEventChannelMachine.subscribe('CREATE_EVENT')
    }
  },
  actions: {
    startConnectionMachine: (context, event) => {
      // start up the realtime messaging (Ably) connection state machine
      const machine = new ConnectionMachine(coreServiceMachine)
      assign({ connectionMachine: (context, event) => machine })
      machine.startService()
    },
    setAppData: assign({ appData: (context, event) => event.data }),
    createCreateEventChannel: (context, event) => {
      // Send a 'CREATE_CHANNEL' event with params to the ConnectionMachine
      // which should Create a Channel Machine with parentMachine 'coreServiceMachine'
      // so Channel Machine can call:
      //   parentMachine.send('ATTACHED', { channelMachine: channelMachine })
      //   parentMachine.send('CREATE_EVENT', {message: message})
      const createChannelEventParams = {
        channelName: coreServiceMachine.createNewEventChannelName(context.appId),
        parentMachine: coreServiceMachine
      }
      context.connectionMachine.send('CREATE_CHANNEL', createChannelEventParams)
    },
    startNewEventMachine: (context, event) => {
      // create a new anearEventMachine and pass it coreServiceMachine so it can send events
      // back to this AppMachine, like REMOVE_EVENT.  The AnearEventMachine will
      // also have access coreServiceMachine.context.connectionMachine so it can send it
      // CREATE_CHANNEL events for each event channel it needs
      const eventJSON = JSON.parse(event.message.data)
      const anearEventId = eventJSON.data.id
      const machine = new AnearEventMachine(coreServiceMachine, eventJSON)

      assign({
        anearEventMachines: {
          ...context.anearEventMachines,
          [anearEventId]: machine
        }
      })
      machine.startService() // new AnearEvent started here!!
    },
    setChannel: assign({ createNewEventChannelMachine: (context, event) => event.channelMachine })
  }
})

class AnearCoreServiceMachine extends AnearBaseMachine {
  constructor(appId, anearApi, AppStateMachineClass, ParticipantStateMachineClass) {
    super(
      AnearCoreServiceMachineConfig,
      AnearCoreServiceMachineFunctions,
      AnearCoreServiceMachineContext(appId, anearApi, AppStateMachineClass, ParticipantStateMachineClass)
    )
  }

  createNewEventChannelName(appId) {
    return `anear:${appId}:e`
  }
}

module.exports = AnearCoreServiceMachine
