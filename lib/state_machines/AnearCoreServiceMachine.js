"use strict"

// The AnearCoreServiceMachine is the highest parent state machine in the hierarchy
// of the AnearService HSM.   It is responsible for the realtime-messaging (ably.io)
// Connection, and all AnearEventMachines spawned for each request to create a new
// AnearEvent for the appId provided.  The developer provides their AppEventMachineClass
// for instantiation and parallel execution as each new Event is created
const { assign } = require('xstate')
const logger = require('../utils/Logger')

const AnearApi = require('../api/AnearApi')
const AnearEvent = require('../models/AnearEvent')
const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearEventMachine = require('../state_machines/AnearEventMachine')
const ConnectionMachine = require('../state_machines/ConnectionMachine')
const RealtimeMessaging = require('../utils/RealtimeMessaging')

const CreateEventChannelNameTemplate = appId => `anear:${appId}:e`

const AnearCoreServiceMachineContext = (appId, anearApi, AppEventMachineClass) => ({
  appId,
  appData: null,
  anearApi,
  realtimeMessaging: null,
  AppEventMachineClass,
  anearEventMachines: {}, // All concurrent anear events handled by this core service
  newEventCreationChannel: null,
})

const AnearCoreServiceMachineConfig = appId => ({
  id: `AnearCoreServiceMachine_${appId}`,
  initial: 'fetchAppDataWithRetry',
  states: {
    fetchAppDataWithRetry: {
      context: {
        retryDelay: 0
      },
      initial: 'fetchAppData',
      states: {
        fetchAppData: {
          invoke: {
            src: 'fetchAppData',
            onDone: {
              actions: ['setAppData'],
              target: '#initRealtimeMessaging'
            },
            onError: {
              actions: ['incrementRetryDelay'], // Increment retryDelay in the context
              target: 'sleepRetry'
            }
          }
        },
        sleepRetry: {
          after: {
            retry_with_backoff_delay: {
              target: 'fetchAppData'
            }
          }
        }
      }
    },
    initRealtimeMessaging: {
      id: 'initRealtimeMessaging',
      entry: ['initiateConnection', 'initRealtime'],
      on: {
        CONNECTED: {
          actions: ['createEventsCreationChannel', 'subscribeCreateEventMessages'],
        },
        ATTACHED: {
          target: 'waitAnearEventLifecycleCommand'
        }
      }
    },
    waitAnearEventLifecycleCommand: {
      // The Anear API backend will send CREATE_EVENT messages with the event JSON data
      // to this createEventMessages Channel when it needs to create a new instance of an
      // Event
      on: {
        CREATE_EVENT: {
          actions: ['spawnNewEventMachine']
        },
        REMOVE_EVENT: {
          actions: ['removeEvent']
        }
      }
    }
  }
})

const AnearCoreServiceMachineFunctions = coreServiceMachine => ({
  services: {
    fetchAppData: context => context.anearApi.getApp(context.appId),
  },
  delays: {
    retry_with_backoff_delay: (context, event) => context.retryDelay
  },
  actions: {
    initiateConnection: assign({realtimeMessaging: context => new RealtimeMessaging(coreServiceMachine)}),
    initRealtime: context => context.realtimeMessaging.initRealtime(context),
    incrementRetryDelay: assign({
      retryDelay: (context, event) => {
        const retryTimesBeforeReset = 6
        const increment = 5000
        const start = increment
        const max = increment * retryTimesBeforeReset
        const nextRetryDelay = context.retryDelay + increment // Add increment
        return nextRetryDelay > max ? start : nextRetryDelay // Reset to start if the delay exceeds max
      }
    }),
    setAppData: assign({ appData: (context, event) => event.data }),
    createEventsCreationChannel: assign(
      {
        newEventCreationChannel: context => {
          const channelName = CreateEventChannelNameTemplate(context.appId)
          return context.realtimeMessaging.getChannel(channelName, coreServiceMachine, {})
        }
      }
    ),
    subscribeCreateEventMessages: context => {
      return context.newEventCreationChannel.subscribe(
        'CREATE_EVENT',
        message => coreServiceMachine.send(message.name, { message })
      )
    },

    spawnNewEventMachine: assign(
      {
        anearEventMachines: (context, event) => {
          const eventJSON = JSON.parse(event.message.data)
          const anearEvent = new AnearEvent(eventJSON)
          return {
            ...context.anearEventMachines,
            [anearEvent.id]: coreServiceMachine.spawnNewEventMachine(context, anearEvent)
          }
        }
      }
    ),
    removeEvent: (context, event) => {
      // need more context to know what to do here
    },
    logFailure: (_, event) => logger.error(`AnearCoreServiceMachine failure cause by event ${event.type}`)
  }
})

class AnearCoreServiceMachine extends AnearBaseMachine {
  constructor(appId, AppEventMachineClass) {
    const anearApi = new AnearApi(process.env.ANEARAPP_API_KEY, process.env.ANEARAPP_API_VERSION)

    super(
      AnearCoreServiceMachineConfig(appId),
      AnearCoreServiceMachineFunctions,
      AnearCoreServiceMachineContext(appId, anearApi, AppEventMachineClass)
    )
  }

  spawnNewEventMachine(context, anearEvent) {
    // NOTE: Here is where you could potentially fan out the CREATE_EVENT to a cluster of service workers
    //   for greater parallelism and load balancing.  Each worker could manage a few dozen active games
    //
    // create a new anearEventMachine and pass it coreServiceMachine so it can send events
    // back to this AppMachine, like REMOVE_EVENT.  The AnearEventMachine will
    // also have access coreServiceMachine.context.connectionMachine so it can send it
    // CREATE_CHANNEL events for each event channel it needs (actions, display, etc.)
    const eventMachine = new AnearEventMachine(
      anearEvent,
      context.realtimeMessaging,
      context.AppEventMachineClass
    )
    eventMachine.spawnChildService()

    logger.debug(`spawned new AnearEventMachine for anearEvent ${anearEvent.id}`)

    return eventMachine
  }
}

module.exports = AnearCoreServiceMachine
