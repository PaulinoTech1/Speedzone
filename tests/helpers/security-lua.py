"""Test-only Lua bridge. JSON stdin/stdout; no network or production state."""
import json
import sys
from lupa import LuaRuntime

data = json.load(sys.stdin)
store = data["store"]
lua = LuaRuntime(unpack_returned_tuples=True)

def unpack(value):
    if hasattr(value, "items"):
        items = dict(value.items())
        if items and all(isinstance(key, int) for key in items):
            return [unpack(items[key]) for key in sorted(items)]
        return {key: unpack(item) for key, item in items.items()}
    return value

def call(command, key, *args):
    if command == "GET": return store.get(key, False)
    if command == "EXISTS": return int(key in store)
    if command == "SET":
        store[key] = args[0]
        return "OK"
    if command == "DEL": return int(store.pop(key, None) is not None)
    # Index and audit bookkeeping do not affect authorization.
    if command in ("ZADD", "ZREM", "HSET", "HDEL", "EXPIRE", "LPUSH", "LTRIM"): return 1
    raise AssertionError(command)

lua.globals().redis = lua.table_from({"call": call})
lua.globals().cjson = lua.table_from({"decode": lambda raw: lua.table_from(json.loads(raw), recursive=True), "encode": lambda value: json.dumps(unpack(value), separators=(",", ":"))})
lua.globals().KEYS = lua.table_from(data["keys"])
lua.globals().ARGV = lua.table_from([str(arg) for arg in data["args"]])
result = lua.execute(data["script"])
print(json.dumps({"result": result, "store": store}))
