"use strict"

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
      entry: 'createChannel',
      on: {
        INITIALIZED: {
          target: 'initialized'
        }
      }
    },
    initialized: {
      entry: 'notifyParentMachineInitialized',
      always: { target: 'attachChannel' }
    },
    attachChannel: {
      type: 'parallel',
      states: {
        attach: {
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
              target: 'attached'
            },
            SUSPENDED: {
            },
            FAILED: {
            }
          }
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
          actions: ['notifyPresenceEvent']
        },
        LEAVE: {
          actions: ['notifyPresenceEvent']
        },
        UPDATE: {
          actions: ['notifyPresenceEvent']
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
      actions: ['turnOffListener'],
      type: 'final'
    }
  }
}

const ChannelMachineFunctions = channelMachine => ({
  actions: {
    createChannel: assign({
      channel: (context, event) => channelMachine.createChannel(context, event),
      presencePrefix: (context, event) => event.presencePrefix
    }),
    turnOffListener: (context, event) => context.channel.off(),
    notifyPresenceEvent: (context, event) => {
      const eventName = context.presencePrefix ? `${context.presencePrefix}_${event.type}` : event.type
      context.parentMachine.send(eventName, event.member)
    },
    notifyParentMachineInitialized: (context, event) => {
      context.parentMachine.send('INITIALIZED', { channelMachine })
    }
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

const NotablePresenceEvents = ['enter', 'leave', 'update']

class ChannelMachine extends AnearBaseMachine {
  constructor(realtimeMessaging, parentMachine, channelName, presencePrefix = null, channelOptions = {}) {
    super(
      ChannelMachineConfig,
      ChannelMachineFunctions,
      ChannelMachineContext(realtimeMessaging, parentMachine, channelName, presencePrefix, channelOptions)
    )
  }

  createChannel(context, { channelName }) {
    const channel = context.realtimeMessaging.getChannel(channelName)
    this.enableCallbacks(context, channel)
  }

  enableCallbacks(context, channel) {
    const {presencePrefix} = context

    channel.on('stateChange', stateChange => this.send(stateChange.current.toUpperCase()))

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
