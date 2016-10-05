# PDI - Minimal Promise based Dependency Injection framework

[![Build Status](https://travis-ci.org/davidgtonge/pdi.svg?branch=master)](https://travis-ci.org/davidgtonge/pdi)

This is a simple library that provides a powerful abstraction for dealing with dependency injection both for system start up and for complex async tasks.

A simple example is as follows:

```js
// File 1
const pdi = require("pdi")
pdi.add("db", () => DB.connect(options))

// File 2
const pdi = require("pdi")
pdi.add("dao", ["db"], (db) => createDao(db))

// File 3
const pdi = require("pdi")
pdi.add("config", configObject)

// File 4
const pdi = require("pdi")
pdi.add(["dao", "config"], (dao, config) => {
  createServer(dao, config)
})

pdi.start()
.then(logSuccess)
.catch(logError)
```



The api consists of:

### `add`

Adds a factory function to the DI container. It offers a flexible API with 3 accepted signatures:

 - `add(name, dependencies, factory)` - Registers a named factory function with dependencies. The factory will only be called when the dependencies are available. They will be passed in as arguments to the factory function.
 - `add(name, factory)` - A simpler form of the above where there are no dependencies.
 - `add(dependencies, factory)` - Registers a factory without a name. This is for side-effect functions.

`name` must be a string

`dependencies` must be an array of strings

`factory` can be either a value or a factory function. If it is not a function it will be wrapped with the `always` function from `Ramda`. If the factory is asynchronous then it should return a promise.

This function will throw on the following conditions:

 - if the DI container has already started
 - if a factory has already been registered with the same name

### `start`

This function accepts no arguments. It starts the DI container and returns a promise that will resolve when all factory functions have resolved.

The function will throw on the following conditions:

 - if `start` has already been called
 - if there is a missing dependency
 - if there is a circular dependency

The function sorts all previously registered factory functions according to the dependency graph. It then calls as many factory functions in parallel as possible. If any of the functions throw then the promise will reject.

### `clear`

This function clears all previously registered functions, it is mainly useful for testing.

### `create`

This function is useful for where the DI container will be used to perform a particular operation, rather then for system start-up. It returns a DI container with the `add`, `start` and `clear` methods.

While being small this library is powerful enough to be used for async flow
control, for example:

```javascript
const flow = pdi()
flow.add("body", req.body)
flow.add("userId", ["body"], prop("userId"))
flow.add("user", ["userId"], getUser)
flow.add("friends", ["user"], getFriends)
flow.add("result", ["friends", "user"], assoc("friends"))
flow.start(["result"])
.then((result) => res.send(result))
.catch((err) => res.sendStatus(500))

```


 Extra utils for testing:

 - `pdi._test.clear()`
 - `pdi._test.`
