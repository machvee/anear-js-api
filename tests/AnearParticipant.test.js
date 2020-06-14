const AnearParticipant = require('../lib/models/AnearParticipant')

const { AnearParticipantFixture1: player1 } =  require('./fixtures')

class TestParticipant extends AnearParticipant {
  initAppData() {
    return {score: 97, responses: ['A', 'C', 'D', 'A']}
  }
}

afterAll(async () => await TestParticipant.close())

test('constructor', () =>  {
  const t = new TestParticipant(player1)
  expect(t.id).toBe(player1.data.id)
  expect(t.relationships.user.data.type).toBe("users")
  expect(t.appData.score).toBe(97)
})

test('participant can be repeatedly rehydrated and updated', async () => {
  try {
    const participant = new TestParticipant(player1)
    await participant.persist()

    let p = await TestParticipant.getFromStorage(player1.data.id)

    expect(p.appData.responses).toStrictEqual(['A', 'C', 'D', 'A'])
    p.appData.responses.push('B')

    await p.update()

    p = await TestParticipant.getFromStorage(player1.data.id)
    expect(p.appData.responses[4]).toBe('B')

    await p.remove()

  } catch(error) {
    console.error(error)
  }
})

