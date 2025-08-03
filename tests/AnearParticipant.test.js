const AnearParticipant = require('../lib/models/AnearParticipant')
const { AnearParticipantFixture1: player1 } = require('./fixtures')

describe('AnearParticipant', () => {
  let participant

  beforeEach(() => {
    participant = new AnearParticipant(player1)
  })

  test('constructor', () => {
    expect(participant.id).toBe(player1.data.id)
    expect(participant.relationships.user.data.type).toBe('users')
  })

  test('setMachine registers a send function', () => {
    const mockService = { send: jest.fn() }
    participant.setMachine(mockService)
    participant.send('SOME_EVENT')
    expect(mockService.send).toHaveBeenCalledWith('SOME_EVENT')
  })

  test('participantInfo returns a subset of attributes', () => {
    const info = participant.participantInfo
    expect(info.id).toBe(participant.id)
    expect(info.name).toBe('machvee')
    expect(info.avatarUrl).toBe('https://s3.amazonaws.com/anearassets/anon_user.png')
    expect(info.type).toBe('participant')
  })

  test('geoLocation can be set and get', () => {
    const location = { latitude: 45.5, longitude: -73.6 }
    participant.geoLocation = location
    expect(participant.geoLocation).toEqual(location)
  })

  test('userId returns the correct user ID', () => {
    expect(participant.userId).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
  })

  test('userType returns the correct user type', () => {
    expect(participant.userType).toBe('participant')
  })

  test('isHost returns false for participants', () => {
    expect(participant.isHost()).toBe(false)
  })

  test('isHost returns true for hosts', () => {
    participant.attributes['user-type'] = 'host'
    expect(participant.isHost()).toBe(true)
  })

  test('eventId returns the correct event ID', () => {
    expect(participant.eventId).toBe('b2aa5a28-2aa1-4ba7-8e2f-fe11dfe1b971')
  })

  test('user getter returns the included user resource', () => {
    expect(participant.user.id).toBe('2d08adc7-b1af-4607-2a86-b45faa03eaa7')
    expect(participant.user.attributes.name).toBe('dave_mcvicar')
  })

  test('profile getter returns the included profile resource', () => {
    expect(participant.profile.id).toBe('a04976a9-1c08-4bc6-b381-7f0d0637b919')
    expect(participant.profile.attributes['last-name']).toBe('McVicar')
  })

  test('name getter returns the correct name', () => {
    expect(participant.name).toBe('machvee')
  })

  test('avatarUrl getter returns the correct URL', () => {
    expect(participant.avatarUrl).toBe('https://s3.amazonaws.com/anearassets/anon_user.png')
  })

  test('privateChannelName returns the correct channel name', () => {
    expect(participant.privateChannelName).toBe('anear:a:6i4GPGg7YiE81jxE65vpov:e:51nriTFWJYwiZRVfhaTmOM:private:4aih3BnWiRXLHKupFFkKHO')
  })
})
