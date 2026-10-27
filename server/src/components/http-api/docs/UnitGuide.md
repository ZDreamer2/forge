# http-api Guide

Owns the server's domain HTTP endpoints. An endpoint selects a source, builds its tree, runs analysis when the operation needs it and maps the result into `api-contract` shapes.

## Notes

Not implemented yet. The identity and changes routes, with their wire mapping, currently live in `app`.

This is the only component combining tree sources with analysis. Domain rules stay in the components owning them; endpoints orchestrate and map.

The server owns structural meaning, ownership, totals and review metadata; clients render and fold rather than derive them. The wire representation of trees remains open. The [API contract](../../../../docs/protocol.md) owns observable behavior.

`app` owns mounting, Host/Origin protection, shared in-flight work and shutdown; this unit owns endpoint behavior. GET and HEAD operations stay read-only.
