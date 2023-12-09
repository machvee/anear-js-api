"use strict"

const logger = require('../utils/Logger')
const { assign } = require('xstate')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')

const ChannelMachineContext = (realtimeMessaging, parentMachine, channelName, presencePrefix, channelOptions) => ({
  realtimeMessaging,
  parentMachine,
  channelName,
  presencePrefix,
  channelOptions,
  channel: null
})

const ChannelMachineConfig = {
  id: 'channelMachine',
  initial: 'createChannel',
  states: {
    createChannel: {
      actions: ['createChannel'],
      always: [{
        target: 'waitAction'
      }],
    },
    waitAction: {
      entry: ['notifyParentMachineCreated'],
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
          actions: ['notifyPresenceEvent']
        },
        LEAVE: {
          actions: ['notifyPresenceEvent']
        },
        UPDATE: {
          actions: ['notifyPresenceEvent']
        },
        // channel events
        SUSPENDED: {
          target: ['error_exit']
        },
        FAILED: {
          target: ['error_exit']
        }
      }
    },
    publisher: {
      invoke: {
        src: 'publishMessage',
        onDone: {
          target: 'waitAction'
        },
        onError: {
        }
      }
    },
    subscriber: {
      invoke: {
        src: 'subscribeMessageType',
        onDone: {
          target: 'waitAction'
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
          target: 'complete'
        },
        FAILED: {
          actions: ['notifyParentMachine'],
          target: 'complete'
        }
      }
    },
    complete: {
      actions: ['turnOffListener'],
      type: 'final'
    },
    error_exit: {
      id: 'error_exit',
      actions: ['throw_error'],
      type: 'final'
    }
  }
}

const ChannelMachineFunctions = channelMachine => ({
  actions: {
    createChannel: assign({
      channel: context => channelMachine.createChannel(context, context.channelName)
    }),
    turnOffListener: (context, event) => context.channel.off(),
    notifyParentMachineCreated: context => context.parentMachine.send('CREATED', { channelMachine }),
    notifyPresenceEvent: (context, event) => {
      const eventName = context.presencePrefix ? `${context.presencePrefix}_${event.type}` : event.type
      context.parentMachine.send(eventName, event.member)
    },
    throw_error: (context, event) => {
      throw new Error(event.data)
    }
  },
  services: {
    attachChannel: context => {
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

const NotableChannelEvents = ['suspended', 'failed']
const NotablePresenceEvents = ['enter', 'leave', 'update']

class ChannelMachine extends AnearBaseMachine {
  constructor(realtimeMessaging, parentMachine, channelName, presencePrefix = null, channelOptions = {}) {
    super(
      ChannelMachineConfig,
      ChannelMachineFunctions,
      ChannelMachineContext(realtimeMessaging, parentMachine, channelName, presencePrefix, channelOptions)
    )
  }

  createChannel(context, channelName) {
    const channel = context.realtimeMessaging.getChannel(channelName)
    logger.debug(`created ${channel.name} channel`)
    this.enableCallbacks(context, channel)
    return channel
  }

  enableCallbacks(context, channel) {
    channel.on(NotableChannelEvents, stateChange => {
      const channelState = stateChange.current
      logger.debug(`${channel.name} state changed to ${channelState}`)
      return this.send(channelState.toUpperCase())
    })

    const { presencePrefix } = context

    if (presencePrefix) {
      NotablePresenceEvents.forEach(
        action => channel.presence.subscribe(
          action,
          member => this.send(action.toUpperCase(), { member })
        )
      )
    }
  }

  publish(message) {
    this.send('PUBLISH', { message })
  }

  subscribe(messageType) {
    this.send('SUBSCRIBE', { messageType })
  }
}

module.exports = ChannelMachine
