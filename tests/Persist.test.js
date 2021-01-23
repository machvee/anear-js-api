const Persist = require('../lib/utils/Persist')

const p = new Persist()
const key = "myModel"

afterAll(
  async () => {
    await p.close()
  }
)

const barb = "Barbie"
const dave = "Dave"

class TestModel {
  constructor(keyArg, nameArg) {
    this.id = 1
    this.key = keyArg
    this.name = nameArg
  }

  toJSON() {
    return {name: this.name, age: 27, state: 'FL'}
  }
}

const testModel = new TestModel(key, barb)
const daveModel = new TestModel(key, dave)

test('constructor', () =>  {
  expect(p).not.toBe(null)
})

test('store a model', async () => {
  try {
    const result = await p.store(testModel)

    expect(testModel.key).toBe(key)
    expect(result).toBe('OK')
  } catch(error) {
    console.error(error)
  }
})

test('fetch a model', async () => {
  try {
    const model = await p.fetch(key)
    expect(model.name).toBe(barb)
  } catch(error) {
    console.error(error)
  }
})

test('remove a model', async () => {
  try {
    const result = await p.remove(testModel)
  } catch(error) {
    console.error(error)
  }
})

test('create a model only once, and exists only when it does', async () => {
  try {
    const result = await p.create(testModel)
    expect(result).toBe('OK')

    let isThere = await p.exists(testModel)
    expect(isThere).toBe(true)

    await expect(p.create(testModel))
      .rejects
      .toThrow('model 1 already exists');

    await p.remove(testModel)

    isThere = await p.exists(testModel)
    expect(isThere).toBe(false)

  } catch(error) {
    console.error(error)
  }
})

test('update a model', async () => {
  try {
    const result = await p.create(testModel)
    expect(result).toBe('OK')

    let model = await p.fetch(key)
    expect(model.name).toBe(barb)

    const ures = await p.update(daveModel)
    expect(ures).toBe('OK')

    model = await p.fetch(key)
    expect(model.name).toBe(dave)

    await p.remove(testModel)
  } catch(error) {
    console.error(error)
  }
})

test('locked call', async () => {
  try {
    const result = await p.create(testModel)
    expect(result).toBe('OK')

    await p.lockCall(
      testModel,
      async () => {
        expect(testModel.name).toBe(barb)
      }
    )
    await p.remove(testModel)
  } catch(error) {
    console.error(error)
  }
})

test('locked fetch', async () => {
  try {
    const result = await p.create(testModel)
    expect(result).toBe('OK')

    const lck1 = p.lockedFetch(
      key,
      async (model) => {
        await p.update(daveModel)
      }
    )
    const lck2 = p.lockedFetch(
      key,
      async (model) => {
        expect(model.name).toBe(dave)
      }
    )
    expect(await lck2).toHaveProperty("name", dave)
    expect(await lck1).toHaveProperty("name", barb)
    await p.remove(testModel)
  } catch(error) {
    console.error(error)
  }
})
