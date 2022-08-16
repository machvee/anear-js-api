const View = require('../lib/utils/View')
const MockMessaging = require('../lib/messaging/__mocks__/AnearMessaging')
const AnearEvent = require('../lib/models/AnearEvent')
const AnearParticipant = require('../lib/models/AnearParticipant')

const { AnearEventFixture: chatEventJson,
        AnearParticipantFixture1: chatParticipant1Json,
        AnearParticipantFixture2: chatParticipant2Json,
        AnearHostFixture: chatHostJson } = require("./fixtures")

class Chat305Event extends AnearEvent {
  initContext() {
    return {
      name: "Chat 305"
    }
  }
}

const MessagingStub = new MockMessaging()

class ChatParticipant extends AnearParticipant {
  initContext() {
    return {
      alias: "Para-bebe",
      age: 23,
    }
  }
}

const MockXStateEvent = participant => ({
  participant: participant.identity,
  room: "420",
  message: "you up?"
})

afterAll(async () => await Chat305Event.close())

test('constructor', () =>  {
  const chatEvent = new Chat305Event(chatEventJson, MessagingStub)
  const v = new View(chatEvent)
  expect(v).toBe
})

test('view can render a single participant', async () => {
  const chatEvent = new Chat305Event(chatEventJson, MessagingStub)
  const spy = jest.spyOn(chatEvent, 'publishEventPrivateMessage').mockImplementation(async () => null);
  const chatStar = new ChatParticipant(chatParticipant1Json)
  const moveTimeout = 120000
  const v = new View(chatEvent)
  const html = '<div class="grid"><div class="participant-name">machvee</div>' 
  + '<div class="participant-alias">Para-bebe</div><div class="chat-name">Chat 305</div>'
  + '<div class="message">you up?</div><div class="status">red</div></div>'

  await v.renderParticipant(
    chatStar,
    "tests/fixtures/views/PrivateGrid.pug",
    chatEvent.context,
    MockXStateEvent(chatStar),
    {
      timeout: moveTimeout,
      color: "red"
    }
  )
  expect(spy).toHaveBeenCalledTimes(1)
  expect(spy).toHaveBeenCalledWith(chatStar, html, moveTimeout)
})

test('view can render to all participant', async () => {
  const chatEvent = new Chat305Event(chatEventJson, MessagingStub)
  const spy = jest.spyOn(chatEvent, 'publishEventParticipantsMessage').mockImplementation(async () => null);
  const lastStar = new ChatParticipant(chatParticipant1Json)
  const moveTimeout = 140000
  const v = new View(chatEvent)
  const html = '<div class="grid"><div class="chat-name">Chat 305</div>'
  + '<div class="message">you up?</div><div class="status">blue</div></div>'

  await v.renderAllParticipants(
    "tests/fixtures/views/ParticipantsGrid.pug",
    chatEvent.context,
    MockXStateEvent(lastStar),
    {
      timeout: moveTimeout,
      color: "blue"
    }
  )
  expect(spy).toHaveBeenCalledTimes(1)
  expect(spy).toHaveBeenCalledWith(html, moveTimeout)
})

test('view can render to each participant privately', async () => {
  const chatEvent = new Chat305Event(chatEventJson, MessagingStub)
  const spy = jest.spyOn(chatEvent, 'publishEventPrivateMessage').mockImplementation(async () => null);
  const v = new View(chatEvent)
  const lastStar1 = new ChatParticipant(chatParticipant1Json)
  const lastStar2 = new ChatParticipant(chatParticipant2Json)
  const html1 = '<div class="grid"><div class="participant-name">machvee</div>' 
  + '<div class="participant-alias">Para-bebe</div><div class="chat-name">Chat 305</div>'
  + '<div class="message">you up?</div><div class="status">green</div></div>'
  const html2 = '<div class="grid"><div class="participant-name">bbondfl93</div>' 
  + '<div class="participant-alias">Para-bebe</div><div class="chat-name">Chat 305</div>'
  + '<div class="message">you up?</div><div class="status">green</div></div>'

  await v.renderEachParticipant(
    [lastStar1, lastStar2],
    "tests/fixtures/views/PrivateGrid.pug",
    chatEvent.context,
    MockXStateEvent(lastStar1),
    {
      color: "green"
    }
  )
  expect(spy).toHaveBeenCalledTimes(2)
  expect(spy).toHaveBeenNthCalledWith(1, lastStar1, html1, 0)
  expect(spy).toHaveBeenNthCalledWith(2, lastStar2, html2, 0)
})

