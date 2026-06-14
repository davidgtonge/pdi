# PDI

![CI](https://github.com/davidgtonge/pdi/actions/workflows/ci.yml/badge.svg)

**Minimal, promise-based dependency injection for Node.js.**

PDI wires up application modules from a dependency graph: register factories across files, call `start()` once, and every module is initialised in the right order — with as much parallelism as the graph allows. The same container also works well for one-off async pipelines (for example, per-request data loading).

- **Tiny** — one dependency (`debug`), no framework lock-in
- **Promise-native** — sync factories, async factories, and thrown errors all work
- **Parallel by default** — independent modules in the same batch run concurrently
- **TypeScript-first** — published with type declarations
- **ESM** — `import pdi from "pdi"`

---

## Installation

```bash
npm install pdi
```

Requires Node.js 18+ (native `Promise`, ESM).

---

## Quick start

Register modules in any order across any number of files. Dependencies are resolved automatically when you call `start()`.

```js
import pdi from "pdi"

// config/db/dao modules can live in separate files — order of registration does not matter
pdi.add("config", [], { port: 3000, dbUrl: process.env.DATABASE_URL })
pdi.add("db", ["config"], ({ config }) => connect(config.dbUrl))
pdi.add("dao", ["db"], ({ db }) => createDao(db))

// side-effect module: runs for its dependencies but is not exposed in the result
pdi.add(["dao", "config"], ({ dao, config }) => {
  startServer(dao, config.port)
})

try {
  const modules = await pdi.start()
  console.log("Ready:", Object.keys(modules)) // ["config", "db", "dao"]
} catch (err) {
  console.error("Startup failed:", err)
}
```

Each factory receives **one argument**: an object containing its declared dependencies, keyed by module name. Use destructuring for named access:

```js
pdi.add("userService", ["db", "cache"], ({ db, cache }) => new UserService(db, cache))
```

---

## Core concepts

### Modules

A **module** is a named value produced by a factory. Register it with `add()`, then read it from the object returned by `start()`.

### Dependency graph

When you declare `pdi.add("a", ["b", "c"], factory)`, module `a` will not run until `b` and `c` have finished. PDI validates the graph at activation time and rejects:

- **Missing dependencies** — a module depends on a name that was never registered
- **Circular dependencies** — direct or indirect cycles in the graph

### Parallel batches

PDI topologically sorts modules into **batches**. Everything in a batch has all of its dependencies satisfied by earlier batches, so modules **within a batch run in parallel** (`Promise.all`). Batches themselves run sequentially.

```
Batch 1:  config, logger     ← run in parallel
Batch 2:  db                 ← waits for config
Batch 3:  dao, cache         ← run in parallel, both wait for db
Batch 4:  api                 ← waits for dao + cache
```

This gives you safe parallelism without manual orchestration.

### Global vs scoped containers

The default export is a **singleton** container — ideal for application startup.

For per-request or per-task pipelines, create an isolated container:

```js
import pdi from "pdi"

const flow = pdi.create()
```

Each instance has its own registry and activation state.

---

## API

### `add(name, factory)`

Register a module with no dependencies.

```js
pdi.add("logger", () => createLogger())
pdi.add("featureFlags", () => loadFlags())
```

`factory` may be sync or async (return a `Promise`).

---

### `add(name, dependencies, factory)`

Register a module that depends on other modules.

```js
pdi.add("db", ["config"], ({ config }) => connect(config.url))
pdi.add("users", ["db"], ({ db }) => db.collection("users"))
```

**`dependencies`** — array of module name strings.

**`factory`** — function **or** a static value. Non-functions are wrapped so the value is returned as-is when the module activates:

```js
pdi.add("config", [], { env: "production" })
pdi.add("version", [], "5.0.0")
```

Factories must accept a **single** argument (the deps object). Multi-argument functions are rejected — this is intentional so dependency names stay explicit via destructuring.

---

### `add(dependencies, factory)`

Register an anonymous **side-effect** module. It runs during activation but its return value is not included in the result of `start()` (it is stored under an internal name).

```js
pdi.add(["dao", "config"], ({ dao, config }) => {
  attachRoutes(app, dao, config)
})
```

Use this for wiring that does not need to be looked up later — starting servers, registering handlers, etc.

---

### `start()`

Resolve the dependency graph and activate all modules.

```js
const modules = await pdi.start()
// modules is a plain object: { config, db, dao, ... }
```

**Throws synchronously** if:

- `start()` has already been called on this container
- The dependency graph has a cycle or a missing module
- A factory throws during activation (the returned promise rejects)

**Returns** a promise that resolves to a shallow copy of all named module values (side-effect modules are omitted from this object).

---

### `strict()`

Enable strict dependency access checks. Call **before** `start()`.

In strict mode, each factory receives its dependencies through a `Proxy`:

1. **No undeclared access** — reading a property you did not list in `dependencies` throws
2. **No unused declarations** — listing a dependency in `dependencies` but never reading it throws

```js
pdi.strict()

pdi.add("a", ["b", "c"], ({ b, c }) => use(b, c)) // OK
pdi.add("a", ["b", "c"], ({ b }) => use(b))       // Error: "c" declared but not accessed
pdi.add("a", ["b"], ({ b, c }) => use(b, c))     // Error: "c" accessed but not declared
```

Strict mode catches typos and stale dependency lists during development. Leave it off in production if you prefer minimal overhead.

---

### `clear()`

Reset the container — clears all registrations, activation state, and strict mode. Primarily for tests.

```js
afterEach(() => pdi.clear())
```

---

### `create()`

Create a new, independent container with the same API.

```js
import pdi, { createInstance } from "pdi"

const container = pdi.create()
// equivalent to:
const container = createInstance()
```

---

## Examples

### Application startup

Split registration across files; only one file needs to call `start()`.

```js
// db.js
import pdi from "pdi"
pdi.add("db", ["config"], ({ config }) => connect(config.databaseUrl))

// config.js
import pdi from "pdi"
pdi.add("config", [], {
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT) || 3000,
})

// index.js
import pdi from "pdi"
import "./config.js"
import "./db.js"

await pdi.start()
```

### Async factories

Factories can return promises. Errors propagate and reject `start()`.

```js
pdi.add("db", async () => {
  const client = await connect(url)
  await client.ping()
  return client
})

pdi.add("migrations", ["db"], async ({ db }) => {
  await runMigrations(db)
})
```

### Per-request pipeline

Use a scoped container to model request handling as a dependency graph:

```js
import pdi from "pdi"

async function handleRequest(req, res) {
  const flow = pdi.create()

  flow.add("body", [], req.body)
  flow.add("userId", ["body"], ({ body }) => body.userId)
  flow.add("user", ["userId"], ({ userId }) => getUser(userId))
  flow.add("friends", ["user"], ({ user }) => getFriends(user))
  flow.add("result", ["friends", "user"], ({ friends, user }) =>
    mergeFriendsAndUser(friends, user),
  )

  try {
    const { result } = await flow.start()
    res.json(result)
  } catch {
    res.sendStatus(500)
  }
}
```

### TypeScript

Types are included. Narrow module shapes at the call site:

```ts
import pdi, { type PdiInstance } from "pdi"

interface Config {
  port: number
}

interface Deps {
  config: Config
  db: Database
}

pdi.add("config", [], { port: 3000 } satisfies Config)

pdi.add("db", ["config"], ({ config }: Pick<Deps, "config">) => {
  return connect(config.port)
})

const modules = await pdi.start()
const db = modules.db as Database
```

---

## Error reference

| Error | Cause |
|-------|-------|
| `DI already activated` | `start()` called twice on the same container |
| `DI already activated - can't register: …` | `add()` called after `start()` |
| `Attempted to register module: … multiple times` | Duplicate module name |
| `… depends on … which hasn't been registered` | Missing dependency in the graph |
| `Circular dependency for … within …` | Cycle detected |
| `Attempted to register … with a length of …` | Factory has more than one parameter |
| `Invalid property access (…) in …` | Strict mode: undeclared dep accessed |
| `Depended on property (…) not accessed in …` | Strict mode: declared dep never read |
| `Can't set strict mode after activation` | `strict()` called after `start()` |

Factory throws and promise rejections during activation reject the `start()` promise.

---

## Testing

Use `clear()` between tests to reset the singleton, or `create()` for isolation:

```js
import { strictEqual } from "node:assert"
import pdi from "pdi"

describe("my app", () => {
  beforeEach(() => pdi.clear())

  it("wires dependencies", async () => {
    pdi.add("answer", [], () => 42)
    pdi.add("result", ["answer"], ({ answer }) => answer * 2)

    const modules = await pdi.start()
    strictEqual(modules.result, 84)
  })
})
```

### Internal test helpers

The default instance exposes `__test` for unit tests of the library itself. **Do not rely on this in application code** — it is not part of the public API guarantee.

```js
pdi.__test.getRegistry()              // current registrations
pdi.__test.getModules()               // activated module values
pdi.__test.isActivated()              // whether start() has run
pdi.__test.checkAndSortDependencies(registry) // topological sort batches
```

---

## Debugging

PDI uses the [`debug`](https://www.npmjs.com/package/debug) package. Enable timing and batch logs:

```bash
DEBUG=pdi node your-app.js
```

---

## Design notes

**Why a single deps object?**  
Positional injection is fragile when dependency lists grow. A single object plus destructuring gives named, self-documenting factories and enables strict-mode validation.

**Why parallel batches?**  
Most DI containers activate sequentially. PDI runs independent modules concurrently within each topological level, which matters when factories do I/O (database connections, config fetches, etc.).

**Why so small?**  
PDI solves one problem well: resolve a dependency graph and return promises. It is not a full IoC container — no decorators, no scopes, no lifecycle hooks. That keeps it easy to reason about and embed.

---

## Migrating from v4

| v4 | v5 |
|----|-----|
| `const pdi = require("pdi")` | `import pdi from "pdi"` |
| Source at `src/index.js` | Compiled ESM at `dist/index.js` |
| `ramda` / `bluebird` dependencies | Native JS / native `Promise` |
| `pdi()` for new instance | `pdi.create()` |

Behaviour of `add`, `start`, `strict`, and `clear` is unchanged.

---

## License

ISC
