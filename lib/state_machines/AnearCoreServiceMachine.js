"use strict"

// The AnearCoreServiceMachine is the highest parent state machine in the hierarchy
// of the AnearService HSM.   It is responsible for the realtime-messaging (ably.io)
// and all AnearEventMachines spawned for each request to create a new
// AnearEvent for the appId provided.  The developer provides their AppEventMachineFactory
// for App XState Machine instantiation and execution as each new Event is created
const { assign, createMachine, interpret, spawn } = require('xstate')
const logger = require('../utils/Logger')

const AnearApi = require('../api/AnearApi')
const AnearEvent = require('../models/AnearEvent')
const AnearEventMachine = require('../state_machines/AnearEventMachine')
const RealtimeMessaging = require('../utils/RealtimeMessaging')
const PugLoader = require('../utils/PugLoader')
const CssUploader = require('../utils/CssUploader')
const ImageAssetsUploader = require('../utils/ImageAssetsUploader')
const C = require('../utils/Constants')

const CreateEventChannelNameTemplate = appId => `anear:${appId}:e`
const DefaultTemplatesRootDir = "./views"

const AnearCoreServiceMachineContext = (appId, appEventMachineFactory, appParticipantMachineFactory) => ({
  appId,
  coreServiceMachine: null,
  appData: null,
  appEventMachineFactory,
  appParticipantMachineFactory,
  anearEventMachines: {}, // All concurrent anear events handled by this core service
  pugTemplates: {},
  imageAssetsUrl: null,
  newEventCreationChannel: null,
  retryDelay: 0
})

const GlobalEventConfig = {
  // This wildcard will catch done.invoke.anearEventMachine_<id>
  'done.invoke.anearEventMachine_*': {
    actions: 'cleanupEventMachine'
  }
}

const AnearCoreServiceMachineConfig = appId => ({
  id: `AnearCoreServiceMachine_${appId}`,
  initial: 'waitForContextUpdate',
  on: GlobalEventConfig,
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
          actions: ['createEventsCreationChannel', 'subscribeCreateEventMessages']
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
        CREATE_EVENT: {
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

const AnearCoreServiceMachineFunctions = {
  services: {
    fetchAppData: context => AnearApi.getApp(context.appId),
    uploadNewImageAssets: context => {
      const uploader = new ImageAssetsUploader(
        C.ImagesDirPath,
        context.appId
      )
      return uploader.uploadAssets()
    },
    minifyCssAndUpload: (context, event) => {
      const uploader = new CssUploader(
        C.CssDirPath,
        context.imageAssetsUrl,
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
    initRealtime: context => RealtimeMessaging.initRealtime(context.appId, context.coreServiceMachine),
    loadPugFiles: assign(
      {
        pugTemplates: context => {
          const pugLoader = new PugLoader(DefaultTemplatesRootDir)
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
          return RealtimeMessaging.getChannel(channelName, context.coreServiceMachine)
        }
      }
    ),
    subscribeCreateEventMessages: context => {
      RealtimeMessaging.subscribe(
        context.newEventCreationChannel,
        context.coreServiceMachine,
        'CREATE_EVENT'
      )
    },
    startNewEventMachine: assign(
      {
        anearEventMachines: (context, event) => {
          const eventJSON = JSON.parse(event.data)
          const anearEvent = new AnearEvent(eventJSON)
          const service = AnearEventMachine(anearEvent, context)

          anearEvent.setMachine(service)

          service.start()

          const actor = spawn(service, `anearEventMachine_${anearEvent.id}`)

          return {
            ...context.anearEventMachines,
            [anearEvent.id]: actor
          }
        }
      }
    ),
    cleanupEventMachine: assign((context, event) => {
      // event.type === "done.invoke.anearEventMachine_<eventId>"
      const [, id] = event.type.match(/^done\.invoke\.anearEventMachine_(.+)$/)

      // remove that actor ref from the map
      const { [id]: dropped, ...remaining } = context.anearEventMachines

      logger.debug(`AEM ${id} is done → cleaning up`)

      return {
        anearEventMachines: remaining
      }
    })
  },
  guards: {
    noImageAssetFilesFound: (_, event) => event.data === null
  }
}

const AnearCoreServiceMachine = (appEventMachineFactory, appParticipantMachineFactory = null) => {
  const appId = process.env.ANEARAPP_APP_ID
  const expandedConfig = {predictableActionArguments: true, ...AnearCoreServiceMachineConfig(appId)}

  const anearCoreServiceMachineContext = AnearCoreServiceMachineContext(
    appId,
    appEventMachineFactory,
    appParticipantMachineFactory
  )

  const coreServiceMachine = createMachine(
    expandedConfig,
    AnearCoreServiceMachineFunctions
  ).withContext(anearCoreServiceMachineContext)

  const coreServiceMachineStarted = interpret(coreServiceMachine).start()

  coreServiceMachineStarted.send('UPDATE_CONTEXT', { coreServiceMachine: coreServiceMachineStarted })

  return coreServiceMachineStarted
}

module.exports = AnearCoreServiceMachine
