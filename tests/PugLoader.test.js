const fs = require("fs")
const path = require("path")
const PugLoader = require("../lib/utils/PugLoader") // Adjust the path as needed

describe("PugLoader", () => {
  const templatesRootDir = path.join(__dirname, "./fixtures/test_pug_templates")
  const pugLoader = new PugLoader(templatesRootDir)

  it("should load and compile Pug templates", () => {
    const compiledTemplates = pugLoader.compiledPugTemplates()

    expect(compiledTemplates).toHaveProperty(['template_1.pug'])
    expect(compiledTemplates).toHaveProperty(['template_2.pug'])
    expect(compiledTemplates).toHaveProperty(['subdir/template_3.pug'])

    const renderedTemplate1 = compiledTemplates['template_1.pug']({ name: 'Alice' })
    const renderedTemplate2 = compiledTemplates['template_2.pug']()
    const renderedTemplate3 = compiledTemplates['subdir/template_3.pug']({name: 'Bob'})

    expect(renderedTemplate1).toBe("<div>Hello, Alice</div>")
    expect(renderedTemplate2).toBe("<p>This is template 2</p>")
    expect(renderedTemplate3).toBe("<div>Hello, Bob</div>")
  })
})
