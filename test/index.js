/* eslint max-nested-callbacks: 0 */
const {ok, equal, deepEqual, throws} = require("assert")
const pdi = require("../src/index")
const sinon = require("sinon")
const {pluck, flatten, compose} = require("ramda")

describe("pdi", () => {
  beforeEach(() => {
    pdi.clear()
  })

  describe("add", () => {
    it("add with 3 args", () => {
      const name = "NAME"
      const fn = function() {}
      const deps = []
      pdi.add(name, deps, fn)
      const registry = pdi.__test.getRegistry()
      equal(registry[name].name, name)
      equal(registry[name].fn, fn)
      equal(registry[name].deps, deps)
    })

    it("add with 2 args", () => {
      const name = "NAME"
      const fn = function() {}
      pdi.add(name, fn)
      const registry = pdi.__test.getRegistry()
      equal(registry[name].name, name)
      equal(registry[name].fn, fn)
      deepEqual(registry[name].deps, [])
    })

    it("throws when same module registered twice", () => {
      const name = "NAME"
      const fn = function() {}
      pdi.add(name, fn)
      throws(() => {
        pdi.add(name, fn)
      })
    })

    it("throws when registing after starting", () => {
      const name = "NAME"
      const fn = function() {}
      pdi.add(name, fn)
      return pdi.start().then(() => {
        throws(() => {
          pdi.add("something", fn)
        })
      })
    })
  })

  describe("check and sort deps", () => {
    it("sorts simple dependencies", () => {
      pdi.add("1", ["2"], sinon.stub())
      pdi.add("2", sinon.stub())
      const registry = pdi.__test.getRegistry()
      const sorted = pdi.__test.checkAndSortDependencies(registry)
      equal(sorted[0][0].name, "2")
      equal(sorted[1][0].name, "1")
    })

    it("throws on circular dependencies", () => {
      pdi.add("1", ["2"], sinon.stub())
      pdi.add("2", ["1"], sinon.stub())
      const registry = pdi.__test.getRegistry()
      throws(() => {
        pdi.__test.checkAndSortDependencies(registry)
      }, /circular dependency/i)
    })

    it("throws on unmet dependencies", () => {
      pdi.add("1", ["2"], sinon.stub())
      pdi.add("2", ["3"], sinon.stub())
      const registry = pdi.__test.getRegistry()
      throws(() => {
        pdi.__test.checkAndSortDependencies(registry)
      }, /hasn't been registered/i)
    })

    it("sorts complex dependencies", () => {
      pdi.add("1", [], sinon.stub())
      pdi.add("2", ["1"], sinon.stub())
      pdi.add("3", ["5"], sinon.stub())
      pdi.add("4", ["1", "2"], sinon.stub())
      pdi.add("5", ["2"], sinon.stub())
      const registry = pdi.__test.getRegistry()
      const sorted = pdi.__test.checkAndSortDependencies(registry)
      const names = compose(pluck("name"), flatten)(sorted)
      equal(sorted.length, 4)
      deepEqual(names, ["1", "2", "4", "5", "3"])
    })

    it("doesn't accept functions who require multiple arguments", () => {
      throws(() => {
        pdi.add("1", [], (a, b) => [a, b])
      }, /single object/i)
    })
  })

  describe("activation", () => {
    it("can only activate once", () => {
      return pdi.start().then(() => {
        throws(() => {
          pdi.start()
        }, /already activated/i)
      })
    })

    it("calls each registered function", () => {
      const fn1 = sinon.stub()
      const fn2 = sinon.stub()
      pdi.add("1", ["2"], fn1)
      pdi.add("2", fn2)
      return pdi.start().then(() => {
        equal(fn1.callCount, 1)
        equal(fn2.callCount, 1)
      })
    })

    it("calls each registered function with deps", () => {
      const foo = Math.random()
      const fn1 = sinon.stub()
      const fn2 = sinon.stub().returns(foo)
      pdi.add("1", ["2"], fn1)
      pdi.add("2", fn2)
      return pdi.start().then(() => {
        ok(fn1.calledWith({"2": foo}))
      })
    })

    it("calls each registered function with multiple deps", () => {
      const foo = Math.random()
      const foo2 = Math.random()
      const fn1 = sinon.stub()
      const fn2 = sinon.stub().returns(foo)
      const fn3 = sinon.stub().returns(foo2)
      pdi.add("1", ["2", "3"], fn1)
      pdi.add("2", fn2)
      pdi.add("3", fn3)
      return pdi.start().then(() => {
        ok(fn1.calledWith({"2": foo, "3": foo2}))
      })
    })
  })
})
