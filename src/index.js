const Promise = require("bluebird")
const {is, always, zipObj, contains, reduce, flatten, curry,
  values, map, flip, apply, prop, compose, merge, difference,
  pluck, filter, forEach} = require("ramda")

const reducer = curry((hash, name, memo, item) => {
  if(!hash[item]) {
    throw new Error(`${name} depends on ${item} which hasn't been registered`)
  }
  let deps = hash[item].deps
  if(contains(name, deps)) {
    throw new Error(`Circular dependency for ${name} within ${item}`)
  }
  if (deps.length) {
    deps = reduce(reducer(hash, name), [], deps)
  }
  return flatten([item, memo, deps])
})

const mapper = curry((hash, {name, deps, fn}) => {
  const result = reduce(reducer(hash, name), [], deps)
  return {result, deps, name, fn}
})

function move(subset, from, to) {
  forEach((item) => {
    const fromPos = from.indexOf(item)
    from.splice(fromPos, 1)
  }, subset)
  to.push(subset)
}

function sorter(array) {
  const input = array
  const output = []
  while(input.length) {
    const sorted = compose(pluck("name"), flatten)(output)
    const ready = filter(({result}) => {
      return difference(result, sorted).length === 0
    }, input)
    move(ready, input, output)
  }
  return output
}

function checkAndSortDependencies(obj) {
  return compose(
    sorter,
    values,
    map(mapper(obj))
  )(obj)
}

function activationReducer(memo, items) {
  const names = pluck("name", items)
  return Promise.map(items, (item) => {
    const args = map(flip(prop)(memo), item.deps)
    return Promise.resolve(apply(item.fn, args))
  }).then(compose(merge(memo), zipObj(names)))
}

function startActivation(array) {
  return Promise.reduce(array, activationReducer, {})
}

function createInstance() {
  let registry = {}
  let modules = {}
  let activated = false
  let nameIdx = 0

  function add(name, deps, fn) {
    if (activated) {
      throw new Error(`DI already activated - can't register: ${name} `)
    }
    // (array, fn) = side effect function
    if (is(Array, name) && is(Function, deps)) {
      fn = deps
      deps = name
      name = "__pdi_side_effect_" + nameIdx++
    }
    if (!fn) {
      fn = deps
      deps = []
    }
    if (registry[name]) {
      throw new Error(`Attempted to register module: ${name} multiple times`)
    }
    if (!is(Function, fn)) {
      fn = always(fn)
    }
    registry[name] = {fn, deps, name}
  }
  function start(deps, fn) {
    if (activated) {
      throw new Error("DI already activated")
    }
    if (deps && fn) {
      add(deps, fn)
    }
    const sorted = checkAndSortDependencies(registry)
    return startActivation(sorted).then((_modules) => {
      modules = _modules
      activated = true
      return modules
    })
  }
  function clear() {
    activated = false
    registry = {}
    modules = {}
  }
  const __test = {
    getRegistry() {
      return registry
    },
    getModules() {
      return modules
    },
    isActivated() {
      return activated
    },
    checkAndSortDependencies,
  }

  return {add, start, clear, __test}
}

const defaultInstance = createInstance()
defaultInstance.create = createInstance

module.exports = defaultInstance
