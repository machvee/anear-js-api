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
    "tests/fixtures/Grid.pug",
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
