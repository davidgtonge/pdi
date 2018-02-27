const Promise = require("bluebird")
const debug = require("debug")("pdi")
const {
  is,
  always,
  zipObj,
  contains,
  reduce,
  flatten,
  curry,
  values,
  map,
  pick,
  flip,
  apply,
  prop,
  compose,
  merge,
  difference,
  pluck,
  filter,
  forEach,
} = require("ramda")

const reducer = curry((hash, name, memo, item) => {
  if (!hash[item]) {
    throw new Error(`${name} depends on ${item} which hasn't been registered`)
  }
  let deps = hash[item].deps
  if (contains(name, deps)) {
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
  forEach(item => {
    const fromPos = from.indexOf(item)
    from.splice(fromPos, 1)
  }, subset)
  to.push(subset)
}

function sorter(array) {
  const input = array
  const output = []
  while (input.length) {
    const sorted = compose(pluck("name"), flatten)(output)
    const ready = filter(({result}) => {
      return difference(result, sorted).length === 0
    }, input)
    move(ready, input, output)
  }
  return output
}

function checkAndSortDependencies(obj) {
  return compose(sorter, values, map(mapper(obj)))(obj)
}

function activationReducer(memo, items) {
  const names = pluck("name", items)
  debug(`Initialising ${names.join(", ")}`)
  return Promise.map(items, item => {
    const opts = pick(item.deps, memo)
    return Promise.resolve(item.fn(opts))
  }).then(compose(merge(memo), zipObj(names)))
}

function startActivation(array) {
  return Promise.reduce(array, activationReducer, {})
}

const addToRegistry = (registry, name, deps, fn) => {
  if (fn.length > 1) {
    throw new Error(
      `Attempted to register ${name} with a length of ${fn.length}
      
      pdi v2 passes all dependencies as a single object to allow developers to simulate 
      named arugments using destructing. It therefore doesn't accept functions with 
      a length of more than 1`
    )
  }
  registry[name] = {fn, deps, name}
}

function createInstance() {
  let registry = {}
  let modules = {}
  let activated = false
  let nameIdx = 0
  const startTime = Date.now()
  let firstAdd

  function add(name, deps, fn) {
    if (!firstAdd) firstAdd = Date.now()
    if (activated) {
      throw new Error(`DI already activated - can't register: ${name} `)
    }
    // (array, fn) = side effect function
    if (is(Array, name) && is(Function, deps)) {
      nameIdx += 1
      return addToRegistry(registry, "__pdi_side_effect_" + nameIdx, name, deps)
    }
    if (registry[name]) {
      throw new Error(`Attempted to register module: ${name} multiple times`)
    }
    if (!fn) {
      return addToRegistry(registry, name, [], deps)
    }
    if (!is(Function, fn)) {
      return addToRegistry(registry, name, deps, always(fn))
    }
    return addToRegistry(registry, name, deps, fn)
  }
  function start(deps, fn) {
    if (activated) {
      throw new Error("DI already activated")
    }
    debug("First add", firstAdd - startTime)
    debug("Activation started", Date.now() - startTime)
    const sorted = checkAndSortDependencies(registry)
    return startActivation(sorted).then(_modules => {
      debug("Activation complete", Date.now() - startTime)
      modules = _modules
      activated = true
      let result = true
      if (deps && fn) {
        debug(`Running start function with ${deps.join(", ")}`)
        result = apply(fn, map(flip(prop)(modules), deps))
      }

      return Promise.resolve(result)
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
