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

const ChatEvent = new Chat305Event(chatEventJson, MessagingStub)
class ChatParticipant extends AnearParticipant {
  initContext() {
    return {
      alias: "Para-bebe",
      age: 23,
    }
  }
}
const NewView = anearEvent => {
  return new View(anearEvent)
}

const MockXStateEvent = participant => ({
  participant: participant.identity,
  room: "420",
  message: "you up?"
})

afterAll(async () => await Chat305Event.close())

test('constructor', () =>  {
  const v = NewView(ChatEvent)
  expect(v).toBe
})

test('view can render spectator view', async () => {
  const v = NewView(ChatEvent)
  const chatStar = new ChatParticipant(chatParticipant1Json)
  await v.render(
    ChatEvent.context,
    MockXStateEvent(chatStar),
    {
      participant: {template: "fixtures/Grid.pug", timeout: 120}
    }
  )
})
