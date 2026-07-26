---
status: accepted
---

# herdr answers one request per connection, so the client is two transports

The herdr socket API answers exactly one request per connection and then sends
EOF. An `events.subscribe` connection is the exception: it stays open to stream
events, and sending any further request on it closes it immediately. The herdr
client therefore has two transports — a connection per request, and one
long-lived connection per event subscription — rather than the single multiplexed
connection the design assumed.

This amends ADR-0001, which describes the Orchestrator as "holding a persistent
connection to the herdr socket API". The conclusion of ADR-0001 is unaffected:
the socket API is still mandatory, because `events.subscribe` still exists only
there and the CLI still forks a process per call. Only the connection model
changes.

## How this was established

Measured against herdr 0.7.5, protocol 17, rather than inferred from the docs,
which do not mention it:

- Send `ping`, read the reply, `recv` again: EOF.
- Send two requests in one write: only the first is answered, then EOF.
- Send the second request after reading the first reply: `EPIPE`.
- `events.subscribe`, then sit idle for four seconds: events stream normally.
  Send `ping` on that same connection: closed 100ms later.
- Any malformed or unknown request is answered with an `invalid_request` error
  envelope carrying `"id": ""`, and then the connection closes.

## Considered options

**One connection per request, plus a dedicated subscription connection.**
Chosen. It is what the protocol permits, and it makes request correlation
structural rather than a matter of bookkeeping: a connection carries one
exchange, so no reply can be mistaken for another's. Concurrent requests are
independent connections and cannot interfere.

**Drive the `herdr` CLI instead.** Rejected again, for the reasons in ADR-0001,
and now for one more: the CLI opens exactly the same one-shot connection per
invocation, so it buys nothing back and adds a process fork.

**A connection pool.** Rejected. A pooled connection cannot be reused after the
one reply it is permitted, so a pool would hold only sockets that are already
closed.

## Consequences

Request correlation still validates the reply's `id` against the request's, even
though only one reply can arrive. It costs nothing and it is the check that
notices we are talking to something that is not herdr.

Framing must still handle several messages in one read, even though replies
cannot arrive that way: the subscription connection delivers bursts of events in
a single read routinely. One decoder serves both paths, and is tested for both.

Reconnection is a property of the subscription, not of requests. There is nothing
to reconnect for a one-shot request — a failure to connect is the failure of that
request, and it is reported as one.

`pane.agent_status_changed` is subscribed per pane, so watching an additional
Worker pane means replacing the subscription rather than extending it. Every
replacement leaves a window in which no events were delivered, and so does every
reconnection. The client closes that window by re-reading `session.snapshot` after
each successful subscribe and reporting any watched pane whose status has moved
since the last one it delivered. A caller is therefore told a pane's status when
it starts watching and whenever it changes — which matters because the state that
hides is `blocked`, and a Worker stopped at a permission prompt emits nothing at
all.

A subscription that cannot be re-established is surfaced as a terminal error
rather than retried forever. Liveness stops being observable at that point, and
an unattended Run that cannot see its Workers must escalate rather than wait.
