"use strict"

// The AnearCoreServiceMachine is the highest parent state machine in the hierarchy
// of the AnearService HSM.   It is responsible for the realtime-messaging (ably.io)
// Connection, and all AnearEventMachines spawned for each request to create a new
// AnearEvent for the appId provided.  The developer provides their AppEventMachineClass
// for instantiation and parallel execution as each new Event is created
const { assign } = require('xstate')
const logger = require('../utils/Logger')

const AnearApi = require('../api/AnearApi')
const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearEventMachine = require('../state_machines/AnearEventMachine')
const ConnectionMachine = require('../state_machines/ConnectionMachine')

const AnearCoreServiceMachineContext = (appId, anearApi, AppEventMachineClass) => ({
  appId,
  appData: null,
  AppEventMachineClass,
  anearEventMachines: {},
  connectionMachine: null,
  createNewEventChannelMachine: null,
  anearApi,
  retryDelay: 0
})

const AnearCoreServiceMachineConfig = {
  id: 'AnearCoreServiceMachine',
  initial: 'fetchAppData',
  states: {
    fetchAppData: {
      invoke: {
        src: 'fetchAppData',
        onDone: {
          actions: ['setAppData', 'createConnectionMachine', 'startConnectionMachine'],
          target: 'waitConnectionMachineConnected'
        },
        onError: {
          actions: ['incrementRetryDelay'], // Increment retryDelay in the context
          target: 'sleepRetryFetchAppData'
        }
      }
    },
    waitConnectionMachineConnected: {
      on: {
        CONNECTED: {
          target: 'createCreateEventsChannel'
        }
      }
    },
    createCreateEventsChannel: {
      entry: 'createCreateEventsChannel',
      on: {
        CREATED: {
          actions: ['setChannel'],
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
      // The Anear API backend will send CREATE_EVENT messages with the event JSON data
      // to this createEventMessages Channel when it needs to create a new instance of an
      // Event
      on: {
        CREATE_EVENT: {
          actions: ['startNewEventMachine']
        },
        REMOVE_EVENT: {
          actions: ['removeEvent']
        }
      }
    },
    sleepRetryFetchAppData: {
      after: {
        retry_with_backoff_delay: {
          target: 'fetchAppData'
        }
      }
    },
    hist: {
      // Is this needed anymore?  no longer referenced here
      type: 'history',
      history: 'shallow'
    },
    failed: {
      entry: 'logFailure',
      type: 'final'
    }
  }
}

const AnearCoreServiceMachineFunctions = coreServiceMachine => ({
  services: {
    fetchAppData: (context, event) => context.anearApi.getApp(context.appId),
    subscribeCreateEventMessages: (context, event) => context.createNewEventChannelMachine.subscribe('CREATE_EVENT')
  },
  delays: {
    retry_with_backoff_delay: (context, event) => context.retryDelay
  },
  actions: {
    createConnectionMachine: assign({connectionMachine: context => new ConnectionMachine(coreServiceMachine, context)}),
    startConnectionMachine: context => context.connectionMachine.startService(),
    incrementRetryDelay: assign({
      retryDelay: (context, event) => {
        const start = 5000
        const increment = 5000
        const max = 30000
        const nextRetryDelay = context.retryDelay + increment // Add increment
        return nextRetryDelay > max ? start : nextRetryDelay // Reset to start if the delay exceeds max
      }
    }),
    setAppData: assign({ appData: (context, event) => event.data }),
    createCreateEventsChannel: (context, event) => {
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
      // NOTE: Here is where you could potentially fan out the CREATE_EVENT to a cluster of service workers
      //   for greater parallelism and load balancing.  Each worker could manage a few dozen active games
      //
      // create a new anearEventMachine and pass it coreServiceMachine so it can send events
      // back to this AppMachine, like REMOVE_EVENT.  The AnearEventMachine will
      // also have access coreServiceMachine.context.connectionMachine so it can send it
      // CREATE_CHANNEL events for each event channel it needs (actions, display, etc.)
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
    removeEvent: (context, event) => {
      // need more context to know what to do here
    },
    logFailure: (context, event) => logger.error(`AnearCoreServiceMachine failure cause by event ${event.type}`),
    setChannel: assign({ createNewEventChannelMachine: (context, event) => event.channelMachine })
  }
})

class AnearCoreServiceMachine extends AnearBaseMachine {
  constructor(appId, AppEventMachineClass) {
    const anearApi = new AnearApi(process.env.ANEARAPP_API_KEY, process.env.ANEARAPP_API_VERSION)
    super(
      AnearCoreServiceMachineConfig,
      AnearCoreServiceMachineFunctions,
      AnearCoreServiceMachineContext(appId, anearApi, AppEventMachineClass)
    )
  }

  createNewEventChannelName(appId) {
    return `anear:${appId}:e`
  }
}

module.exports = AnearCoreServiceMachine
