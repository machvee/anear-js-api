"use strict"

// The AnearCoreServiceMachine is the highest parent state machine in the hierarchy
// of the AnearService HSM.   It is responsible for the realtime-messaging (ably.io)
// and all AnearEventMachines spawned for each request to create a new
// AnearEvent for the appId provided.  The developer provides their AppEventMachineFactory
// for App XState Machine instantiation and execution as each new Event is created
const { assign, createMachine, interpret } = require('xstate')
const logger = require('../utils/Logger')

const AnearApi = require('../api/AnearApi')
const AnearEvent = require('../models/AnearEvent')
const AnearEventMachine = require('../state_machines/AnearEventMachine')
const RealtimeMessaging = require('../utils/RealtimeMessaging')
const PugLoader = require('../utils/PugLoader')
const CssUploader = require('../utils/CssUploader')
const ImageAssetsUploader = require('../utils/ImageAssetsUploader')
const Constants = require('../utils/Constants')

const CreateEventChannelNameTemplate = appId => `anear:${appId}:e`

const AnearCoreServiceMachineContext = (appId, anearApi, realtimeMessaging, appEventMachineFactory, appParticipantMachineFactory) => ({
  appId,
  coreServiceMachine: null,
  appData: null,
  anearApi,
  realtimeMessaging,
  appEventMachineFactory,
  appParticipantMachineFactory,
  anearEventMachines: {}, // All concurrent anear events handled by this core service
  pugTemplates: {},
  imageAssetsUrl: null,
  newEventCreationChannel: null,
})

const AnearCoreServiceMachineConfig = appId => ({
  id: `AnearCoreServiceMachine_${appId}`,
  initial: 'waitForContextUpdate',
  states: {
    waitForContextUpdate: {
      id: 'waitForContextUpdate',
      on: {
        UPDATE_CONTEXT: {
          actions: ['updateContextWithMachineRef'],
          target: 'fetchAppDataWithRetry'
        }
      }
    },
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
      entry: ['initRealtime'],
      on: {
        CONNECTED: {
          actions: ['createEventsCreationChannel', 'subscribeCreateEventMessages'],
        },
        ATTACHED: 'uploadNewImageAssets'
      }
    },
    uploadNewImageAssets: {
      invoke: {
        src: 'uploadNewImageAssets',
        onDone: {
          actions: assign({
            // event.data has imageAssetsUrl returned by src service
            imageAssetsUrl: (_context, event) => event.data
          }),
          target: 'minifyCssAndUpload'
        },
        onError: '#failure' // Handle failure state or transition
      }
    },
    minifyCssAndUpload: {
      invoke: {
        id: 'minifyCssAndUpload',
        src: 'minifyCssAndUpload',
        onDone: {
          target: 'loadAndCompilePugTemplates'
        },
        onError: '#failure'
      }
    },
    loadAndCompilePugTemplates: {
      entry: ['loadPugFiles'],
      always: {
        target: 'waitAnearEventLifecycleCommand'
      }
    },
    waitAnearEventLifecycleCommand: {
      // The Anear API backend will send CREATE_EVENT messages with the event JSON data
      // to this createEventMessages Channel when it needs to create a new instance of an
      // Event
      entry: (context, event) => logger.debug(`Waiting on ${context.appData.data.attributes['short-name']} lifecycle command`),
      on: {
        [Constants.CreateEventEventName]: {
          actions: ['startNewEventMachine']
        },
        REMOVE_EVENT: {
          actions: ['removeEvent']
        }
      }
    },
    failure: {
      id: 'failure',
      entry: (context, event) => logger.debug("Failure! ", event.data),
      type: 'final'
    }
  }
})

const AnearCoreServiceMachineFunctions = ({
  services: {
    fetchAppData: context => context.anearApi.getApp(context.appId),
    uploadNewImageAssets: context => {
      const uploader = new ImageAssetsUploader(
        Constants.ImagesDirPath,
        context.anearApi,
        context.appId
      )
      return uploader.uploadAssets()
    },
    minifyCssAndUpload: (context, event) => {
      const uploader = new CssUploader(
        Constants.CssDirPath,
        context.imageAssetsUrl,
        context.anearApi,
        context.appId
      )

      return uploader.uploadCss()
    }
  },
  delays: {
    retry_with_backoff_delay: (context, event) => context.retryDelay
  },
  actions: {
    updateContextWithMachineRef: assign(
      {
        coreServiceMachine: (_, event) => event.coreServiceMachine
      }
    ),
    initRealtime: context => context.realtimeMessaging.initRealtime(context.coreServiceMachine),
    loadPugFiles: assign(
      {
        pugTemplates: context => {
          const pugLoader = new PugLoader(context.imageAssetsUrl)
          const templates = pugLoader.compiledPugTemplates()
          logger.debug(`loaded pug templates ${Object.keys(templates)}`)
          return templates
        }
      }
    ),
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
    setAppData: assign(
      {
        appData: (_, event) => {
          logger.debug(`fetched ${event.data.data.attributes["short-name"]} app data`)
          return event.data
        }
      }
    ),
    createEventsCreationChannel: assign(
      {
        newEventCreationChannel: context => {
          const channelName = CreateEventChannelNameTemplate(context.appId)
          return context.realtimeMessaging.getChannel(channelName, context.coreServiceMachine)
        }
      }
    ),
    subscribeCreateEventMessages: context => {
      context.realtimeMessaging.subscribe(
        context.newEventCreationChannel,
        context.coreServiceMachine,
        Constants.CreateEventEventName
      )
    },
    startNewEventMachine: assign(
      {
        anearEventMachines: (context, event) => {
          const eventJSON = JSON.parse(event.message)
          const anearEvent = new AnearEvent(eventJSON)

          anearEvent.anearEventMachine = AnearEventMachine(anearEvent, context)

          return {
            ...context.anearEventMachines,
            [anearEvent.id]: anearEvent.anearEventMachine.start()
          }
        }
      }
    ),
    removeEvent: (context, event) => {
      // need more context to know what to do here
    },
    logFailure: (_, event) => logger.error(`AnearCoreServiceMachine failure cause by event ${event.type}`)
  },
  guards: {
    noImageAssetFilesFound: (_, event) => event.data === null
  }
})

const AnearCoreServiceMachine = (appEventMachineFactory, appParticipantMachineFactory = null) => {
  const appId = process.env.ANEARAPP_APP_ID
  const anearApi = new AnearApi(process.env.ANEARAPP_API_KEY, process.env.ANEARAPP_API_VERSION)
  const expandedConfig = {predictableActionArguments: true, ...AnearCoreServiceMachineConfig(appId)}
  const realtimeMessaging = new RealtimeMessaging(appId, anearApi)

  const anearCoreServiceMachineContext = AnearCoreServiceMachineContext(
    appId,
    anearApi,
    realtimeMessaging,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  const coreServiceMachine = createMachine(
    expandedConfig,
    AnearCoreServiceMachineFunctions
  ).withContext(anearCoreServiceMachineContext)

  const coreServiceMachineStarted = interpret(coreServiceMachine).start()

  coreServiceMachineStarted.send(Constants.UpdateContextEventName, { coreServiceMachine: coreServiceMachineStarted })

  return coreServiceMachineStarted
}

module.exports = AnearCoreServiceMachine
