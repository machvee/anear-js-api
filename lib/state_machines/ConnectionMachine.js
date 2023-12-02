"use strict"

const logger = require('../utils/Logger')
const { assign } = require('xstate')
const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const ChannelMachine = require('../state_machines/ChannelMachine')
const RealtimeMessaging = require('../utils/RealtimeMessaging')

const ConnectionMachineContext = (coreServiceMachine, appId, anearApi ) => ({
  coreServiceMachine,
  appId,
  anearApi,
  realtimeMessaging: null
})

const ConnectionMachineConfig = {
  id: 'connectionMachine',
  initial: 'initiateConnection',
  on: {
    update: 'hist'
  },
  states: {
    initiateConnection: {
      entry: ['initiateConnection', 'initRealtime'],
      on: {
        INITIALIZED: 'initialized',
        CONNECTING: 'connecting'
      }
    },
    initialized: {
      on: {
        CONNECTING: 'connecting'
      }
    },
    connecting: {
      on: {
        CONNECTED: {
          actions: ['notifyCoreServiceMachine'],
          target: 'connected'
        }
      }
    },
    connected: {
      on: {
        CREATE_CHANNEL: {
          actions: ['createNewChannel']
        },
        DISCONNECTED: {
          target: 'disconnected', 
        },
        SUSPENDED: {
          target: 'suspended'
        }
      }
    },
    disconnected: {
      entry: ['notifyCoreServiceMachine'],
      on: {
        CONNECTING: 'connecting',
        FAILED: 'failed'
      }
    },
    failed: {
      // no hope of reconnecting
      type: 'final'
    },
    suspended: {
      entry: ['notifyCoreServiceMachine'],
      on: {
      }
    },
    hist: {
      // used to transition back to child state if/when a participant REFRESH
      // or SPECTATOR_VIEW event occurs
      type: 'history',
      history: 'shallow'
    }
  }
}

const ConnectionMachineFunctions = connectionMachine => ({
  actions: {
    initiateConnection: assign({ realtimeMessaging: (context, event) => new RealtimeMessaging(connectionMachine) }),
    initRealtime: (context, event) => context.realtimeMessaging.initRealtime(context),
    createNewChannel: (context, event) => {
      const machine = new ChannelMachine(
        context.realtimeMessaging,
        event.parentMachine,
        event.channelName,
        event.presencePrefix
      )
      machine.startService()
    },
    notifyCoreServiceMachine: (context, event) => context.coreServiceMachine.send(event.type)
  }
})

class ConnectionMachine extends AnearBaseMachine {
  constructor(coreServiceMachine, { appId, anearApi }) {
    super(
      ConnectionMachineConfig,
      ConnectionMachineFunctions,
      ConnectionMachineContext(coreServiceMachine, appId, anearApi)
    )
  }
}

module.exports = ConnectionMachine
