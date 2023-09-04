"use strict"

const { assign } = require('xstate')
const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const ChannelMachine = require('../state_machines/ChannelMachine')
const RealtimeMessaging = require('../utils/RealtimeMessaging')

const DEFAULT_MESSAGING_IDLE_TIMEOUT_MSECS = 15000

const ConnectionMachineContext = appMachine => ({
  appMachine,
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
      entry: 'initiateConnection',
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
          actions: ['notifyAppMachine'],
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
      entry: ['notifyAppMachine'],
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
      entry: ['notifyAppMachine'],
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
    initiateConnection: (context, event) => {
      const realtimeMessaging = new RealtimeMessaging(context.appMachine)
      assign({ realtimeMessaging: (context, event) => realtimeMessaging.initRealtime(context) })
    },
    createNewChannel: (context, event) => {
      const machine = new ChannelMachine(
        context.realtimeMessaging,
        event.parentMachine,
        event.channelName,
        event.presencePrefix
      )
      machine.startService()
    },
    notifyAppMachine: (context, event) => context.appMachine.send(event.type)
  }
})

class ConnectionMachine extends AnearBaseMachine {
  constructor(appMachine) {
    super(
      ConnectionMachineConfig,
      ConnectionMachineFunctions,
      ConnectionMachineContext(appMachine)
    )
  }
}

module.exports = ConnectionMachine
