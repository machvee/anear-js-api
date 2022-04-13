"use strict"

// Default configuration and options funcs provide
// a simple default state machine for an anear Event.  This is
// so we don't mandate that app developers use xState to drive
// their app's state transitions. Devs simply provide callbacks
// override implementations in their AnearEvent subclass.
// The xState context is simply the anearEvent.context
//
// If a developer wants an xState machine to drive the applications
// state transitions, the developer should override stateMachineConfig()
// and stateMachineOptions() in their AnearEvent subclass.
//
const DefaultConfigFunc = (anearEvent) => {

  const PromiseResolveReject = {
    onDone: {
      target: 'eventActive'
    },
    onError: {
      actions: 'logError',
      target: 'eventActive'
    }
  }

  return {
    id: "defaultXstateConfig",
    initial: 'eventActive',
    states: {
      eventActive: {
        on: {
          JOIN: {
            target: 'join'
          },
          REFRESH: {
            target: 'refresh'
          },
          CLOSE: {
            target: 'close'
          },
          TIMEOUT: {
            target: 'timeout'
          },
          '*': {
            // default wildcard state is presumed to be a custom ACTION name
            // embedded in a anear-action-click property in the app's HTML
            target: 'action'
          }
        }
      },
      join: {
        invoke: {
          id: 'join',
          src: 'joinEventHandler',
          ...PromiseResolveReject
        }
      },
      refresh: {
        invoke: {
          id: 'refresh',
          src: 'refreshEventHandler',
          ...PromiseResolveReject
        }
      },
      close: {
        invoke: {
          id: 'close',
          src: 'closeEventHandler',
          ...PromiseResolveReject
        }
      },
      timeout: {
        invoke: {
          id: 'timeout',
          src: 'timeoutEventHandler',
          ...PromiseResolveReject
        }
      },
      action: {
        invoke: {
          id: 'action',
          src: 'actionEventHandler',
          ...PromiseResolveReject
        }
      }
    }
  }
}

const DefaultOptionsFunc = anearEvent => {
  return {
    actions: {
      logError: (context, event) => logger.error(`error message: ${event.data}`)
    },
    services: {
      joinEventHandler: (context, event) => anearEvent.participantEnterEventCallback(event.participant),
      refreshEventHandler: (context, event) => anearEvent.participantRefreshEventCallback(event.participant, event.remainingTimeout),
      closeEventHandler: (context, event) => anearEvent.participantCloseEventCallback(event.participant),
      timeoutEventHandler: (context, event) => anearEvent.participantTimedOutEventCallback(event.participant),
      actionEventHandler: (context, event) => anearEvent.participantActionEventCallback(event.participant, event.type, event.payload)
    }
  }
}

module.exports = {
  DefaultConfigFunc,
  DefaultOptionsFunc
}
