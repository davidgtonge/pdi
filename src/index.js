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
  forEach((item) => {
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

const activationReducer = (strictMode) => (memo, items) => {
  const names = pluck("name", items)
  debug(`Initialising ${names.join(", ")}`)
  return Promise.map(items, (item) => {
    const _opts = pick(item.deps, memo)
    if (!strictMode) {
      return Promise.resolve(item.fn(_opts))
    }

    const accessed = []
    const opts = new Proxy(_opts, {
      get(target, prop) {
        if (target[prop]) {
          accessed.push(prop)
          return target[prop]
        }
        throw new Error(`Invalid property access: ${prop}`)
      },
    })

    const result = item.fn(opts)

    const notAccessed = difference(item.deps, accessed)
    if (notAccessed.length) {
      throw new Error(
        `Depended on property not accessed: ${notAccessed.join(",")}`,
      )
    }

    return Promise.resolve(result)
  }).then(compose(merge(memo), zipObj(names)))
}

function startActivation(array, strictMode) {
  return Promise.reduce(array, activationReducer(strictMode), {})
}

const addToRegistry = (registry, name, deps, fn) => {
  if (fn.length > 1) {
    throw new Error(
      `Attempted to register ${name} with a length of ${fn.length}
      
      pdi v2 passes all dependencies as a single object to allow developers to simulate 
      named arugments using destructing. It therefore doesn't accept functions with 
      a length of more than 1`,
    )
  }
  registry[name] = {fn, deps, name}
}

function createInstance() {
  let registry = {}
  let modules = {}
  let activated = false
  let nameIdx = 0
  let strictMode = false
  const startTime = Date.now()
  let firstAdd

  const strict = () => {
    if (activated) {
      throw new Error("Can't set strict mode after activation")
    }
    strictMode = true
  }

  function add(name, deps, fn) {
    if (!firstAdd) firstAdd = Date.now()
    if (activated) {
      throw new Error(`DI already activated - can't register: ${name}`)
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
  function start() {
    if (activated) {
      throw new Error("DI already activated")
    }
    debug("First add", firstAdd - startTime)
    debug("Activation started", Date.now() - startTime)
    const sorted = checkAndSortDependencies(registry)
    return startActivation(sorted, strictMode).then((_modules) => {
      debug("Activation complete", Date.now() - startTime)
      modules = _modules
      activated = true
      return Object.assign({}, modules)
    })
  }
  function clear() {
    activated = false
    strictMode = false
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

  return {add, start, clear, strict, __test}
}

const defaultInstance = createInstance()
defaultInstance.create = createInstance

module.exports = defaultInstance
