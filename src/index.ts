import debugFactory from "debug"

const debug = debugFactory("pdi")

type ModuleFn = (deps: Record<string, unknown>) => unknown | Promise<unknown>

interface RegistryEntry {
  name: string
  deps: string[]
  fn: ModuleFn
}

type Registry = Record<string, RegistryEntry>
type Modules = Record<string, unknown>

interface MappedEntry extends RegistryEntry {
  result: string[]
}

type SortedBatch = MappedEntry[]

function pick(keys: string[], obj: Modules): Modules {
  const result: Modules = {}
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result
}

function flatten<T>(arrays: T[][]): T[] {
  return arrays.flat()
}

function reducer(
  hash: Registry,
  name: string,
  memo: string[],
  item: string,
): string[] {
  if (!hash[item]) {
    throw new Error(`${name} depends on ${item} which hasn't been registered`)
  }
  let deps = hash[item].deps
  if (deps.includes(name)) {
    throw new Error(`Circular dependency for ${name} within ${item}`)
  }
  if (deps.length) {
    deps = deps.reduce(
      (acc, dep) => reducer(hash, name, acc, dep),
      [] as string[],
    )
  }
  return flatten([[item], memo, deps])
}

function mapper(hash: Registry, entry: RegistryEntry): MappedEntry {
  const result = entry.deps.reduce(
    (acc, dep) => reducer(hash, entry.name, acc, dep),
    [] as string[],
  )
  return { ...entry, result }
}

function move(subset: MappedEntry[], from: MappedEntry[], to: SortedBatch[]) {
  for (const item of subset) {
    const fromPos = from.indexOf(item)
    from.splice(fromPos, 1)
  }
  to.push(subset)
}

function sorter(array: MappedEntry[]): SortedBatch[] {
  const input = [...array]
  const output: SortedBatch[] = []
  while (input.length) {
    const sorted = flatten(output.map((batch) => batch.map((entry) => entry.name)))
    const ready = input.filter(
      (entry) => entry.result.filter((dep) => !sorted.includes(dep)).length === 0,
    )
    move(ready, input, output)
  }
  return output
}

function checkAndSortDependencies(obj: Registry): SortedBatch[] {
  return sorter(Object.values(obj).map((entry) => mapper(obj, entry)))
}

function activationReducer(strictMode: boolean) {
  return async (memo: Modules, items: MappedEntry[]): Promise<Modules> => {
    const names = items.map((item) => item.name)
    debug(`Initialising ${names.join(", ")}`)

    const results = await Promise.all(
      items.map(async (item) => {
        const _opts = pick(item.deps, memo)
        if (!strictMode) {
          return item.fn(_opts)
        }

        const accessed: string[] = []
        const opts = new Proxy(_opts, {
          get(target, prop) {
            if (typeof prop !== "string") {
              return undefined
            }
            if (prop in target) {
              accessed.push(prop)
              return target[prop]
            }
            throw new Error(`Invalid property access (${prop}) in ${item.name}`)
          },
        })

        const result = item.fn(opts)

        const notAccessed = item.deps.filter((dep) => !accessed.includes(dep))
        if (notAccessed.length) {
          throw new Error(
            `Depended on property (${notAccessed.join(",")}) not accessed in ${item.name}`,
          )
        }

        return result
      }),
    )

    const batch = Object.fromEntries(names.map((name, index) => [name, results[index]]))
    return { ...memo, ...batch }
  }
}

async function startActivation(
  array: SortedBatch[],
  strictMode: boolean,
): Promise<Modules> {
  let memo: Modules = {}
  for (const items of array) {
    memo = await activationReducer(strictMode)(memo, items)
  }
  return memo
}

function constantValue<T>(value: T): ModuleFn {
  return () => value
}

function addToRegistry(
  registry: Registry,
  name: string,
  deps: string[],
  fn: ModuleFn,
) {
  if (fn.length > 1) {
    throw new Error(
      `Attempted to register ${name} with a length of ${fn.length}

      pdi v2 passes all dependencies as a single object to allow developers to simulate
      named arugments using destructing. It therefore doesn't accept functions with
      a length of more than 1`,
    )
  }
  registry[name] = { fn, deps, name }
}

export interface PdiInstance {
  add(name: string, fn: ModuleFn): void
  add(name: string, deps: string[], fn: ModuleFn | unknown): void
  add(deps: string[], fn: ModuleFn): void
  start(): Promise<Modules>
  clear(): void
  strict(): void
  create: typeof createInstance
  __test: {
    getRegistry(): Registry
    getModules(): Modules
    isActivated(): boolean
    checkAndSortDependencies(obj: Registry): SortedBatch[]
  }
}

export function createInstance(): PdiInstance {
  let registry: Registry = {}
  let modules: Modules = {}
  let activated = false
  let nameIdx = 0
  let strictMode = false
  const startTime = Date.now()
  let firstAdd: number | undefined

  const strict = () => {
    if (activated) {
      throw new Error("Can't set strict mode after activation")
    }
    strictMode = true
  }

  function add(
    name: string | string[],
    depsOrFn: string[] | ModuleFn | unknown,
    fn?: ModuleFn | unknown,
  ) {
    if (!firstAdd) firstAdd = Date.now()
    if (activated) {
      throw new Error(`DI already activated - can't register: ${String(name)}`)
    }

    if (Array.isArray(name) && typeof depsOrFn === "function") {
      nameIdx += 1
      return addToRegistry(
        registry,
        `__pdi_side_effect_${nameIdx}`,
        name,
        depsOrFn as ModuleFn,
      )
    }

    const moduleName = name as string
    const deps = Array.isArray(depsOrFn) ? depsOrFn : []
    const factory = fn ?? depsOrFn

    if (registry[moduleName]) {
      throw new Error(`Attempted to register module: ${moduleName} multiple times`)
    }

    if (fn === undefined) {
      return addToRegistry(registry, moduleName, [], depsOrFn as ModuleFn)
    }

    const moduleFn =
      typeof factory === "function" ? (factory as ModuleFn) : constantValue(factory)
    return addToRegistry(registry, moduleName, deps, moduleFn)
  }

  function start(): Promise<Modules> {
    if (activated) {
      throw new Error("DI already activated")
    }
    debug("First add", (firstAdd ?? startTime) - startTime)
    debug("Activation started", Date.now() - startTime)
    const sorted = checkAndSortDependencies(registry)
    return startActivation(sorted, strictMode).then((_modules) => {
      debug("Activation complete", Date.now() - startTime)
      modules = _modules
      activated = true
      return { ...modules }
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

  return { add, start, clear, strict, __test, create: createInstance }
}

const defaultInstance = createInstance()
defaultInstance.create = createInstance

export default defaultInstance
