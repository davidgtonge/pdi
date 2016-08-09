PDI - Minimal Promise based Dependency Injection framework

Simple API:

 - `pdi.add(name, deps, fn)` Adds a module by name and with depedencies
 - `pdi.start(deps, fn)`
 - `pdi.clear` used when testing to reset the DI

 Extra utils for testing:

 - `pdi._test.clear()`
 - `pdi._test.`


While being small this library is powerful enough to be used for async flow
control, for example:

```
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
