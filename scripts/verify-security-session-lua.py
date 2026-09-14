"""Execute production Lua against in-memory Redis primitives (requires lupa).

This tests the actual script branches, not a Python reimplementation of them.
No network, production credentials, or production records are used.
"""
import json
import re
from pathlib import Path
from lupa import LuaRuntime

ROOT = Path(__file__).resolve().parents[1]
NOW = 1_000_000
ABSOLUTE = 14_400_000
IDLE = 900_000
lua = LuaRuntime(unpack_returned_tuples=True)
store = {}


def unpack(value):
    if hasattr(value, "items"):
        items = dict(value.items())
        if items and all(isinstance(key, int) for key in items):
            return [unpack(items[key]) for key in sorted(items)]
        return {key: unpack(item) for key, item in items.items()}
    return value


def redis_call(command, key, *args):
    if command == "GET":
        return store.get(key, False)
    if command == "EXISTS":
        return int(key in store)
    if command == "SET":
        store[key] = args[0]
        return "OK"
    if command == "DEL":
        return int(store.pop(key, None) is not None)
    if command in ("ZADD", "ZREM", "HSET", "HDEL"):
        return 1  # Index maintenance is outside the authorization decision.
    raise AssertionError(f"Unexpected Redis command: {command}")


lua.globals().redis = lua.table_from({"call": redis_call})
lua.globals().cjson = lua.table_from({
    "decode": lambda raw: lua.table_from(json.loads(raw), recursive=True),
    "encode": lambda value: json.dumps(unpack(value), separators=(",", ":")),
})


def script(file, name):
    source = (ROOT / file).read_text(encoding="utf-8")
    return re.search(r"const " + name + r"\s*=\s*`(.*?)`;", source, re.S).group(1)


validate = script("security-console/lib/auth.ts", "validateScript")
upgrade = script("security-console/lib/auth.ts", "upgradeScript")
migrate = script("security-console/lib/legacy-passkeys.ts", "migrateScript")


def run(source, keys, args):
    lua.globals().KEYS = lua.table_from(keys)
    lua.globals().ARGV = lua.table_from([str(arg) for arg in args])
    return lua.execute(source)


def seed(**changes):
    session = dict(id="original", createdAt=NOW - 100_000, lastSeenAt=NOW - 1000,
                   epoch=3, generation="generation-a", level="password")
    session.update(changes)
    store.clear()
    store.update(old=json.dumps(session), generation="generation-a", epoch="3")


def valid(required="mfa", key="old"):
    return run(validate, [key, "generation", "epoch"], [NOW, ABSOLUTE, IDLE, required])


def elevate(epoch=3):
    return run(upgrade, ["old", "new", "generation", "epoch", "index", "map"],
               [epoch, NOW, ABSOLUTE, IDLE, "replacement"])


count = 0


def check(condition, label):
    global count
    assert condition, label
    count += 1
    print(f"PASS {label}")


seed()
check(valid() == 0, "password session cannot read dashboard")
check(valid("password") == 1, "password session can reach assertion step")
seed(level="mfa")
check(valid() == 0, "old enrollment-created MFA session is rejected")
check(valid("password") == 0, "old MFA session cannot reach credential-management helpers")
seed(level="mfa", passkeyVerifiedAt=NOW - 500)
check(valid() == 1, "assertion-backed MFA session can read dashboard")
seed(level="mfa", passkeyVerifiedAt=NOW + 1)
check(valid() == 0, "future assertion timestamps are rejected")
seed()
check(elevate() == 1 and "old" not in store, "verified assertion rotates and consumes password session")
check(valid(key="new") == 1, "rotated session authorizes dashboard")
check(elevate() == 0, "consumed password session cannot be replayed")
for label, change in [
    ("revoked generation", {"generation": "generation-b"}),
    ("changed epoch", {"epoch": "4"}),
    ("deleted session", {"old": None}),
]:
    seed()
    for key, value in change.items():
        if value is None:
            store.pop(key, None)
        else:
            store[key] = value
    check(elevate() == 0 and "new" not in store, label + " blocks elevation")
seed()
check(elevate(2) == 0, "assertion from another epoch cannot elevate")
for label, changes in [
    ("idle expiry", {"lastSeenAt": NOW - IDLE}),
    ("absolute expiry", {"createdAt": NOW - ABSOLUTE}),
]:
    seed(**changes)
    check(elevate() == 0, label + " blocks elevation")

legacy = '[{"id":"established","publicKey":"AQID","counter":7}]'
mapped = '[{"id":"established","publicKey":"AQID","counter":7,"credentialEpoch":3}]'
keys = ["currentKeys", "legacyKeys", "epoch", "legacyEpoch", "hash", "legacyHash"]
args = [legacy, "3", "verified-hash", "verified-legacy-hash", mapped]


def seed_legacy():
    store.clear()
    store.update(legacyKeys=legacy, epoch="3", legacyEpoch="3",
                 hash="verified-hash", legacyHash="verified-legacy-hash")


seed_legacy()
check(run(migrate, keys, args) == 1 and store["currentKeys"] == mapped,
      "legacy migration preserves key material and counter")
check(store["legacyKeys"] == legacy, "legacy record is preserved")
seed_legacy()
store["legacyKeys"] = '[ { "counter":7, "publicKey":"AQID", "id":"established" } ]'
check(run(migrate, keys, args) == 1, "legacy JSON ordering and whitespace do not block migration")
seed_legacy()
store["legacyKeys"] = r'[{"id":"established","publicKey":"AQID","counter":7,"name":"Windows \/ phone"}]'
named = json.loads(store["legacyKeys"])
named_args = [json.dumps(named), *args[1:4], json.dumps([{**named[0], "credentialEpoch": 3}])]
check(run(migrate, keys, named_args) == 1, "legacy escaped slashes do not block migration")
seed_legacy()
store["legacyKeys"] = '[{"id":"established","publicKey":"AQID","counter":8}]'
check(run(migrate, keys, args) == 0, "concurrent legacy counter update blocks migration")
for key, value in [("currentKeys", "[]"), ("epoch", "4"), ("legacyEpoch", "2"),
                   ("hash", "changed"), ("legacyHash", "changed"), ("legacyKeys", "[]")]:
    seed_legacy()
    store[key] = value
    check(run(migrate, keys, args) == 0, f"migration refuses concurrent or authoritative {key} change")
print(f"{count} Lua authorization assertions passed")
