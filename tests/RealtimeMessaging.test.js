"use strict"



const mockChannel = {
  name: 'mock-channel',
  on: jest.fn(),
  attach: jest.fn(() => Promise.resolve()),
  detach: jest.fn(() => Promise.resolve()),
  publish: jest.fn(() => Promise.resolve()),
  subscribe: jest.fn(),
  presence: {
    get: jest.fn(() => Promise.resolve([])),
    subscribe: jest.fn(),
  },
}

const mockRealtimeInstance = {
  connection: {
    on: jest.fn(),
  },
  channels: {
    get: jest.fn().mockReturnValue(mockChannel),
  },
  close: jest.fn(),
}

jest.doMock('ably', () => ({
  Realtime: jest.fn(() => mockRealtimeInstance),
}))

const RealtimeMessaging = require('../lib/utils/RealtimeMessaging')
const Ably = require('ably')

jest.mock('../lib/api/AnearApi', () => ({
  api_base_url: 'https://mock.api.anear.com',
  defaultHeaderObject: { 'X-Mock-Header': 'true' },
}))
jest.mock('../lib/utils/Logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}))

describe('RealtimeMessaging', () => {
  let mockActor

  beforeEach(() => {
    // Reset mocks and the singleton's internal state before each test
    jest.clearAllMocks()
    RealtimeMessaging.ablyRealtime = null
    mockActor = {
      id: 'test-actor',
      send: jest.fn(),
    }
  })

  afterEach(() => {
    RealtimeMessaging.close()
  })

  describe('initRealtime', () => {
    it('initializes Ably.Realtime with client options', () => {
      RealtimeMessaging.initRealtime('app-123', mockActor)
      expect(Ably.Realtime).toHaveBeenCalledTimes(1)
    })

    it('registers a connection state change listener', () => {
      RealtimeMessaging.initRealtime('app-123', mockActor)
      expect(mockRealtimeInstance.connection.on).toHaveBeenCalledWith(expect.any(Function))
    })

    it('sends state changes to the actor', () => {
      RealtimeMessaging.initRealtime('app-123', mockActor)
      const stateChangeCallback = mockRealtimeInstance.connection.on.mock.calls[0][0]

      stateChangeCallback({ current: 'connected' })
      expect(mockActor.send).toHaveBeenCalledWith('CONNECTED')

      stateChangeCallback({ current: 'suspended' })
      expect(mockActor.send).toHaveBeenCalledWith('SUSPENDED')
    })
  })

  describe('getChannel', () => {
    it('gets a channel from ably and enables callbacks', () => {
      RealtimeMessaging.initRealtime('app-123', mockActor) // need to init first
      const channelName = 'test-channel'
      const channelParams = { params: { rewind: 1 } }
      const channel = RealtimeMessaging.getChannel(channelName, mockActor, channelParams)

      expect(mockRealtimeInstance.channels.get).toHaveBeenCalledWith(channelName, channelParams)
      expect(channel).toBe(mockChannel)
      expect(mockChannel.on).toHaveBeenCalledWith(['attached', 'suspended', 'failed'], expect.any(Function))
    })
  })

  describe('enableCallbacks', () => {
    it('registers a channel state change listener', () => {
      RealtimeMessaging.enableCallbacks(mockChannel, mockActor)
      expect(mockChannel.on).toHaveBeenCalledWith(['attached', 'suspended', 'failed'], expect.any(Function))
    })

    it('sends channel state changes to the actor', () => {
      RealtimeMessaging.enableCallbacks(mockChannel, mockActor)
      const stateChangeCallback = mockChannel.on.mock.calls[0][1]

      stateChangeCallback({ current: 'attached' })
      expect(mockActor.send).toHaveBeenCalledWith('ATTACHED', { actor: mockActor })

      stateChangeCallback({ current: 'failed' })
      expect(mockActor.send).toHaveBeenCalledWith('FAILED', { actor: mockActor })
    })
  })

  describe('enablePresenceCallbacks', () => {
    it('subscribes to presence events', () => {
      const presencePrefix = 'TEST_PREFIX'
      const presenceEvents = ['enter', 'leave']
      RealtimeMessaging.enablePresenceCallbacks(mockChannel, mockActor, presencePrefix, presenceEvents)

      expect(mockChannel.presence.subscribe).toHaveBeenCalledTimes(2)
      expect(mockChannel.presence.subscribe).toHaveBeenCalledWith('enter', expect.any(Function))
      expect(mockChannel.presence.subscribe).toHaveBeenCalledWith('leave', expect.any(Function))
    })

    it('sends presence events to the actor', () => {
      const presencePrefix = 'PARTICIPANT'
      const presenceEvents = ['enter']
      RealtimeMessaging.enablePresenceCallbacks(mockChannel, mockActor, presencePrefix, presenceEvents)

      const presenceCallback = mockChannel.presence.subscribe.mock.calls[0][1]
      const message = { data: { id: 'user-1' } }
      presenceCallback(message)

      expect(mockActor.send).toHaveBeenCalledWith('PARTICIPANT_ENTER', { data: message.data })
    })
  })

  describe('getPresenceOnChannel', () => {
    it('calls presence.get and returns members', async () => {
      const members = [{ id: '1' }, { id: '2' }]
      mockChannel.presence.get.mockResolvedValue(members)
      const result = await RealtimeMessaging.getPresenceOnChannel(mockChannel)
      expect(mockChannel.presence.get).toHaveBeenCalledTimes(1)
      expect(result).toBe(members)
    })
  })

  describe('attachTo', () => {
    it('calls channel.attach', async () => {
      await RealtimeMessaging.attachTo(mockChannel)
      expect(mockChannel.attach).toHaveBeenCalledTimes(1)
    })
  })

  describe('publish', () => {
    it('calls channel.publish', async () => {
      const message = { some: 'data' }
      await RealtimeMessaging.publish(mockChannel, 'event-name', message)
      expect(mockChannel.publish).toHaveBeenCalledWith('event-name', message)
    })
  })

  describe('detachAll', () => {
    it('detaches all valid channels provided', async () => {
      const channel2 = { ...mockChannel, name: 'channel2', detach: jest.fn(() => Promise.resolve()) }
      const channels = [mockChannel, channel2, null, undefined]
      await RealtimeMessaging.detachAll(channels)
      expect(mockChannel.detach).toHaveBeenCalledTimes(1)
      expect(channel2.detach).toHaveBeenCalledTimes(1)
    })

    it('rejects if any detach fails', async () => {
      const error = new Error('Detach failed')
      mockChannel.detach.mockRejectedValue(error)
      await expect(RealtimeMessaging.detachAll([mockChannel])).rejects.toThrow(error)
    })
  })

  describe('subscribe', () => {
    it('subscribes to a channel with an event name', () => {
      RealtimeMessaging.subscribe(mockChannel, mockActor, 'event-name')
      expect(mockChannel.subscribe).toHaveBeenCalledWith('event-name', expect.any(Function))
    })

    it('subscribes to a channel without an event name', () => {
      RealtimeMessaging.subscribe(mockChannel, mockActor)
      expect(mockChannel.subscribe).toHaveBeenCalledWith(expect.any(Function))
    })

    it('sends received messages to the actor', () => {
      RealtimeMessaging.subscribe(mockChannel, mockActor, 'event-name')
      const messageCallback = mockChannel.subscribe.mock.calls[0][1]
      const message = { name: 'incoming-event', data: { info: 'abc' } }
      messageCallback(message)
      expect(mockActor.send).toHaveBeenCalledWith(message.name, { data: message.data })
    })
  })

  describe('close', () => {
    it('closes the ablyRealtime connection and nullifies it', () => {
      RealtimeMessaging.initRealtime('app-123', mockActor)
      expect(RealtimeMessaging.ablyRealtime).not.toBeNull()
      RealtimeMessaging.close()
      expect(mockRealtimeInstance.close).toHaveBeenCalledTimes(1)
      expect(RealtimeMessaging.ablyRealtime).toBeNull()
    })

    it('does nothing if ablyRealtime is not initialized', () => {
      RealtimeMessaging.close()
      expect(mockRealtimeInstance.close).not.toHaveBeenCalled()
    })
  })

  describe('ablyClientOptions', () => {
    it('builds the correct client options', () => {
      delete process.env.ANEARAPP_ABLY_LOG_LEVEL
      const appId = 'app-xyz'
      RealtimeMessaging.initRealtime(appId, mockActor)
      const options = Ably.Realtime.mock.calls[0][0]

      expect(options.authUrl).toBe('https://mock.api.anear.com/messaging_auth')
      expect(options.authHeaders).toEqual({ 'X-Mock-Header': 'true' })
      expect(options.authParams).toEqual({ 'app-id': appId })
      expect(options.echoMessages).toBe(false)
      expect(options.log.level).toBe(0) // default
      expect(options.transportParams.heartbeatInterval).toBe(15000)
    })

    it('uses environment variables for log level and heartbeat', () => {
      process.env.ANEARAPP_ABLY_LOG_LEVEL = 4
      process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS = 30

      RealtimeMessaging.initRealtime('app-123', mockActor)
      const options = Ably.Realtime.mock.calls[0][0]

      expect(options.log.level).toBe("4")
      expect(options.transportParams.heartbeatInterval).toBe(30000)
      delete process.env.ANEARAPP_ABLY_LOG_LEVEL
      delete process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS
    })
  })
})
