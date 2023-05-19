"use strict"

const { assign } = require('xstate')
const logger = require('../utils/Logger')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')

const ChannelMachineContext = (connectionMachine, realtimeMessaging, channelName, parentMachine, channelOptions) => ({
  connectionMachine,
  realtimeMessaging,
  parentMachine,
  channelName,
  channelOptions,
  channel: null
})

const ChannelMachineConfig = {
  id: 'channelMachine',
  initial: 'createChannel',
  states: {
    createChannel: {
      entry: 'createChannel',
      on: {
        INITIALIZED: {
          target: 'attachChannel'
        }
      }
    },
    attachChannel: {
      invoke: {
        src: 'attachChannel',
        onDone: {
          target: 'waitAttached' 
        },
        onError: {
        }
      }
    },
    waitAttached: {
      on: {
        ATTACHING: {},
        ATTACHED: {
          actions: ['notifyParentMachine'],
          target: 'attached'
        },
        SUSPENDED: {
        },
        FAILED: {
        }
      }
    },
    attached: {
      on: {
        DETACH: {
          target: 'detachChannel'
        },
        PUBLISH: {
          target: 'publisher'
        },
        SUBSCRIBE: {
          target: 'subscriber'
        },
        // Presence channel events
        ENTER: {
          actions: ['notifyParentMachine']
        },
        LEAVE: {
          actions: ['notifyParentMachine']
        },
        UPDATE: {
          actions: ['notifyParentMachine']
        }
      }
    },
    publisher: {
      invoke: {
        src: 'publishMessage',
        onDone: {
          target: 'attached'
        },
        onError: {
        }
      }
    },
    subscriber: {
      invoke: {
        src: 'subscribeMessageType',
        onDone: {
          target: 'attached'
        },
        onError: {
        }
      }
    },
    detachChannel: {
      invoke: {
        src: 'detachChannel',
        onDone: {
          target: 'waitDetached'
        },
        onError: {
          target: 'complete'
        }
      }
    },
    waitDetached: {
      on: {
        DETACHING: '.',
        DETACHED: {
          actions: ['notifyParentMachine'],
          target: 'complete'
        },
        FAILED: {
          actions: ['notifyParentMachine'],
          target: 'complete'
        }
      }
    },
    complete: {
      actions: ['turnOffListener', 'deleteChannel'],
      type: 'final'
    }
  }
}

const ChannelMachineFunctions = channelMachine => ({
  actions: {
    createChannel: assign({ channel: (context, event) => channelMachine.createChannel(context, event) }),
    deleteChannel: (context, event) => context.connectionMachine.send('DELETE_CHANNEL', {channelName: event.channelName}),
    turnOffListener: (context, event) => context.channel.off(),
    notifyParentMachine: (context, event) => context.parentMachine.send(event.type, event.member)
  },
  services: {
    attachChannel: (context, event) => {
      return context.channel.attach()
    },
    detachChannel: (context, event) => {
      return context.channel.detach()
    },
    publishMessage: (context, event) => {
      return context.channel.publish(event.messageType, event.payload)
    },
    subscribeMessageType: (context, event) => {
      return context.channel.subscribe(
        event.messageType,
        message => context.parentMachine.send(message.name, { message })
      )
    }
  }
})

class ChannelMachine extends AnearBaseMachine {
  constructor(realtimeMessaging, channelName, parentMachine, channelOptions = {}) {
    super(
      ChannelMachineConfig,
      ChannelMachineFunctions,
      ChannelMachineContext(realtimeMessaging, channelName, parentMachine, channelOptions)
    )
  }

  createChannel(context, { channelName, presence }) {
    const channel = context.realtimeMessaging.getChannel(channelName)

    channel.on('stateChange', stateChange => this.send(stateChange.current.toUpperCase()))

    if (presence) {
      ['enter', 'leave', 'update'].forEach(
        action => channel.presence.subscribe(
          action,
          member => this.send(action.toUpperCase(), { member })
        )
      )
    }

    return channel
  }

  publish(message) {
    this.send('PUBLISH', { message })
  }

  subscribe(messageType) {
    this.send('SUBSCRIBE', { messageType })
  }
}

module.exports = ChannelMachine
