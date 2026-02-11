# Doc update checklist

Update/create `docs/` when you answer yes to any:

- Did we add/change an external contract (HTTP/CLI/events/jobs)?
- Did we add/change persistent data, schema, or invariants?
- Did we add/change config/env vars/flags/defaults?
- Did we change operational behavior (run/deploy/debug/rollback)?
- Did we change security posture (authn/z, secret handling, permissions)?
- Would a future engineer make a wrong change without this knowledge?

If all are no and it is a refactor with identical behavior, skip docs.
