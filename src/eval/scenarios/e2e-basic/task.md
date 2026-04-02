The calculator server in `server.ts` has bugs. All four arithmetic operations return wrong results.

Examples of the broken behavior (run `bun server.ts` and try these):
- `GET /calculate?op=add&a=10&b=3` should return `{"result":13}` but returns wrong value
- `GET /calculate?op=subtract&a=10&b=3` should return `{"result":7}` but returns wrong value
- `GET /calculate?op=multiply&a=4&b=5` should return `{"result":20}` but returns wrong value
- `GET /calculate?op=divide&a=10&b=2` should return `{"result":5}` but returns wrong value

Fix the bugs so all four operations work correctly.
