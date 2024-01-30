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
const CssProcessing = require('../utils/CssProcessing')
const ImagesArchiver = require('../utils/ImagesArchiver')

const CreateEventChannelNameTemplate = appId => `anear:${appId}:e`
const UpdateContextEventName =  'UPDATE_CONTEXT'
const CreateEventEventName = 'CREATE_EVENT'
const ImagesDirPath = 'assets/images'
const CssDirPath = 'assets/css'

const AnearCoreServiceMachineContext = (appId, anearApi, realtimeMessaging, appEventMachineFactory) => ({
  appId,
  coreServiceMachine: null,
  appData: null,
  anearApi,
  realtimeMessaging,
  appEventMachineFactory,
  anearEventMachines: {}, // All concurrent anear events handled by this core service
  pugTemplates: {},
  css: null,
  cssFileSuffix: null,
  cssUrl: null, // send this to each newly entering Participant and Spectator
  encodedImageAssets: null,
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
        ATTACHED: 'archiveImageAssets'
      }
    },
    archiveImageAssets: {
      invoke: {
        src: 'imagesArchiver',
        onDone: [
          {
            cond: 'noImageAssetFilesFound',
            target: 'buildAndMinifyCss'
          },
          {
            actions: assign({
              encodedImageAssets: (_, event) => event.data
            }),
            target: 'uploadImageArchive'
          }
        ],
        onError: '#failure' // Handle failure state or transition
      }
    },
    uploadImageArchive: {
      invoke: {
        src: 'uploadImageAssets',
        onDone: {
          actions: assign(
            {
              imageAssetsUrl: (_context, event) => event.data["image-assets-url"]
            }
          ),
          target: 'buildAndMinifyCss'
        },
        onError: '#failure' // Handle failure state or transition
      }
    },
    buildAndMinifyCss: {
      invoke: {
        id: 'buildAndMinifyCss',
        src: 'buildAndMinifyCss',
        onDone: {
          actions: assign({
            css: (_, event) => event.data.css,
            cssFileSuffix: (_, event) => event.data.fileSuffix
          }),
          target: 'uploadCssForClientAccess'
        },
        onError: '#failure'
      }
    },
    uploadCssForClientAccess: {
      invoke: {
        id: 'uploadCssForClientAccess',
        src: 'uploadCssForClientAccess',
        onDone: {
          actions: ['updateAppCssUrl'],
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
      on: {
        [CreateEventEventName]: {
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
    buildAndMinifyCss: context => CssProcessing(CssDirPath, context.imageAssetsUrl),
    uploadCssForClientAccess: (context, event) => context.anearApi.uploadAppCss(
      context.appId,
      context.css,
      context.cssFileSuffix
    ),
    imagesArchiver: context => new ImagesArchiver(ImagesDirPath).createTarball(),
    uploadImageAssets: context => context.anearApi.uploadAppImageAssets(
      context.appId,
      context.encodedImageAssets
    )
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
    updateAppCssUrl: assign(
      {
        cssUrl: (_, event) => event.data['css-url'],
        css: _ => null // uploaded and not needed locally
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
        CreateEventEventName
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

const AnearCoreServiceMachine = appEventMachineFactory => {
  const appId = process.env.ANEARAPP_APP_ID
  const anearApi = new AnearApi(process.env.ANEARAPP_API_KEY, process.env.ANEARAPP_API_VERSION)
  const expandedConfig = {predictableActionArguments: true, ...AnearCoreServiceMachineConfig(appId)}
  const realtimeMessaging = new RealtimeMessaging(appId, anearApi)

  const anearCoreServiceMachineContext = AnearCoreServiceMachineContext(
    appId,
    anearApi,
    realtimeMessaging,
    appEventMachineFactory
  )

  const coreServiceMachine = createMachine(
    expandedConfig,
    AnearCoreServiceMachineFunctions
  ).withContext(anearCoreServiceMachineContext)

  const coreServiceMachineStarted = interpret(coreServiceMachine).start()

  coreServiceMachineStarted.send(UpdateContextEventName, { coreServiceMachine: coreServiceMachineStarted })

  return coreServiceMachineStarted
}

module.exports = AnearCoreServiceMachine
