# OpenTelemetry HTTP and HTTPS Instrumentation for Node.js

[![NPM Published Version][npm-img]][npm-url]
[![Apache License][license-image]][license-image]

**Note: This is an experimental package under active development. New releases may include breaking changes.**

This module provides automatic instrumentation for [`http`](https://nodejs.org/api/http.html) and [`https`](https://nodejs.org/api/https.html).

## Installation

```bash
npm install --save @opentelemetry/instrumentation-http
```

## Supported Versions

- Nodejs `>=14`

## Usage

OpenTelemetry HTTP Instrumentation allows the user to automatically collect telemetry and export it to their backend of choice, to give observability to distributed systems.

To load a specific instrumentation (HTTP in this case), specify it in the Node Tracer's configuration.

```js
const { trace } = require('@opentelemetry/api');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ConsoleSpanExporter, TracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

const tracerProvider = new TracerProvider({
  spanProcessors: [
    new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })
  ]
});
trace.setGlobalTracerProvider(tracerProvider);
// See https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/sdk-trace/
// for a more complete example setting up a *context manager* and *propagators*.

registerInstrumentations({
  instrumentations: [new HttpInstrumentation()],
});
```

See [examples/http](https://github.com/open-telemetry/opentelemetry-js/tree/main/examples/http) for a short example.

### Http instrumentation Options

Http instrumentation has a few [configuration options](https://github.com/open-telemetry/opentelemetry-js/blob/e1ec4026edae53a2dea3a9a604d6d21bb5e8d99f/experimental/packages/opentelemetry-instrumentation-http/src/types.ts#L60-L93) available to choose from.
You can set the following:

Options                                 | Type                                       | Description
--------------------------------------- | ------------------------------------------ | -----------
`applyCustomAttributesOnSpan`           | `HttpCustomAttributeFunction`              | Function for adding custom attributes
`requestHook`                           | `HttpRequestCustomAttributeFunction`       | Function for adding custom attributes before request is handled
`responseHook`                          | `HttpResponseCustomAttributeFunction`      | Function for adding custom attributes before response is handled
`startIncomingSpanHook`                 | `StartIncomingSpanCustomAttributeFunction` | Function for adding custom attributes before a span is started in incomingRequest
`startOutgoingSpanHook`                 | `StartOutgoingSpanCustomAttributeFunction` | Function for adding custom attributes before a span is started in outgoingRequest
`serverMetricAttributesHook`            | `HttpServerMetricCustomAttributeFunction`  | **Experimental.** Function for adding custom attributes to the `http.server.request.duration` metric. See [Custom metric attributes](#custom-metric-attributes).
`clientMetricAttributesHook`            | `HttpClientMetricCustomAttributeFunction`  | **Experimental.** Function for adding custom attributes to the `http.client.request.duration` metric. See [Custom metric attributes](#custom-metric-attributes).
`ignoreIncomingRequestHook`             | `IgnoreIncomingRequestFunction`            | Function for filtering incoming requests. HTTP instrumentation will not trace incoming requests for which the function returns `true`.
`ignoreOutgoingRequestHook`             | `IgnoreOutgoingRequestFunction`            | Function for filtering outgoing requests. HTTP instrumentation will not trace outgoing requests for which the function returns `true`.
`disableOutgoingRequestInstrumentation` | `boolean`                                  | Set to true to avoid instrumenting outgoing requests at all. This can be helpful when another instrumentation handles outgoing requests.
`disableIncomingRequestInstrumentation` | `boolean`                                  | Set to true to avoid instrumenting incoming requests at all. This can be helpful when another instrumentation handles incoming requests.
`serverName`                            | `string`                                   | **Deprecated.** No longer used. Stable HTTP semantic conventions do not include the `http.server_name` attribute; this option has no effect.
`requireParentforOutgoingSpans`         | Boolean                                    | Require that is a parent span to create new span for outgoing requests.
`requireParentforIncomingSpans`         | Boolean                                    | Require that is a parent span to create new span for incoming requests.
`headersToSpanAttributes`               | `object`                                   | Specify which HTTP headers should be captured as span attributes. This is an object of the form `{client: {requestHeaders: [...], responseHeaders: [...]}, server: {requestHeaders: [...], responseHeaders: [...]}}`, where each `[...]` is an array of HTTP header names (case-insensitive) to capture. Client (outgoing requests, incoming responses) and server (incoming requests, outgoing responses) headers will be converted to span attributes in the form of `http.{request,response}.header.$header_name`, e.g. `http.response.header.content_length`. By default hyphens in header names are converted to underscore. However, if stable semantic conventions are selected (see next section), then, hyphens in header names are not changed, e.g. `http.response.header.content-length`.

#### Hook function signatures

Hook type                                  | Parameters                                                                                                   | Return value
------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------
`IgnoreIncomingRequestFunction`            | `request: IncomingMessage`                                                                                   | `true` skips tracing the incoming request; `false` traces it
`IgnoreOutgoingRequestFunction`            | `request: RequestOptions`                                                                                    | `true` skips tracing the outgoing request; `false` traces it
`HttpRequestCustomAttributeFunction`       | `span: Span`, `request: ClientRequest` or `IncomingMessage`                                                  | `void`
`HttpResponseCustomAttributeFunction`      | `span: Span`, `response: IncomingMessage` or `ServerResponse`                                                | `void`
`StartIncomingSpanCustomAttributeFunction` | `request: IncomingMessage`                                                                                   | `Attributes` to add before the incoming request span starts
`StartOutgoingSpanCustomAttributeFunction` | `request: RequestOptions`                                                                                    | `Attributes` to add before the outgoing request span starts
`HttpCustomAttributeFunction`              | `span: Span`, `request: ClientRequest` or `IncomingMessage`, `response: IncomingMessage` or `ServerResponse` | `void`
`HttpServerMetricCustomAttributeFunction`  | `attributes: Attributes`, `info: { request: IncomingMessage, response: ServerResponse }`                     | `Attributes` to add to the server duration metric, or `undefined`
`HttpClientMetricCustomAttributeFunction`  | `attributes: Attributes`, `info: { request: ClientRequest, response?: IncomingMessage }`                     | `Attributes` to add to the client duration metric, or `undefined`

### Custom metric attributes

> [!WARNING]
> **Keep the returned attributes low cardinality.** Every distinct combination
> of attribute values creates a separate time series in your metrics backend,
> and a separate accumulator held in memory by the SDK. Returning an unbounded
> value is the single easiest way to exhaust the SDK's cardinality limit (2000
> attribute sets per instrument by default), at which point further attribute
> sets are folded into an overflow series and your metric becomes useless.
>
> Return booleans or small closed enums whose value set you control. **Never**
> return raw header values, user or session IDs, request URLs or paths, query
> parameters, IP addresses, or anything else derived from untrusted input. In
> particular, do **not** return `url.path` or `url.full` — a public endpoint
> receiving arbitrary paths will generate a new series per unique path. If you
> want a route dimension, emit a low-cardinality `http.route` instead, which
> the instrumentation already picks up from the framework instrumentation via
> `RPCMetadata`.

`serverMetricAttributesHook` and `clientMetricAttributesHook` are called once
per recorded measurement, immediately before the duration histogram is
recorded. At that point the response is complete, so the status code and route
are already known and are visible in the `attributes` argument.

The hooks are **additive**: the returned attributes are merged *over* the
attributes the instrumentation computed, and a returned key that collides with
one of those is dropped with a warning logged through `diag`. This keeps the
semantic-convention attributes required by the spec from being silently
removed or rewritten. The `attributes` object passed to the hook is a copy;
mutating it has no effect, only the return value is used.

Returning `undefined` (or nothing at all) adds nothing. A hook that throws is
contained: the error is logged through `diag`, the request proceeds normally,
and the measurement is still recorded with the computed attributes.

The example below splits inbound request metrics by a boolean derived from a
custom request header, so that dashboards and alerts can separate two classes
of traffic that are otherwise identical across every semantic-convention
attribute. Note that the *presence* of the header is recorded as a boolean —
the header's value is never used as an attribute value.

```js
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');

// A closed set of known dependencies. Anything unrecognized collapses into a
// single 'other' bucket, which keeps the cardinality bounded no matter what
// host the request is made to.
const KNOWN_DEPENDENCIES = new Set(['billing.internal', 'search.internal']);

const httpInstrumentation = new HttpInstrumentation({
  serverMetricAttributesHook: (attributes, { request, response }) => {
    return {
      // Low cardinality: exactly two values. The header's value is compared,
      // never used as the attribute value.
      'acme.privileged_client': request.headers['x-acme-privileged'] === '1',
    };
  },
  clientMetricAttributesHook: (attributes, { request, response }) => {
    return {
      'acme.dependency': KNOWN_DEPENDENCIES.has(request.host)
        ? request.host
        : 'other',
    };
  },
});
```

For the client hook, `info.response` is `undefined` when the metric is recorded
for a request that never produced a response — for example an aborted request,
a socket error, or a DNS failure. Guard on it before dereferencing.

## Semantic Conventions

**Span attributes:**

v1.23.0 semconv                     | Short Description
----------------------------------- | -----
`client.address`                    | The IP address of the original client behind all proxies, if known
`network.protocol.version`          | Kind of HTTP protocol used
`server.address`                    | The value of the HTTP host header
`http.request.method`               | HTTP request method
(opt-in, `headersToSpanAttributes`) | The size of the request payload body in bytes. For newer semconv, use the `headersToSpanAttributes` option to capture this as `http.request.header.content-length`.
(not included)                      | The size of the uncompressed request payload body after transport decoding. (In semconv v1.23.0 this is defined by `http.request.body.size`, which is experimental and opt-in.)
(opt-in, `headersToSpanAttributes`) | The size of the response payload body in bytes. For newer semconv, use the `headersToSpanAttributes` option to capture this as `http.response.header.content-length`.
(not included)                      | The size of the uncompressed response payload body after transport decoding. (In semconv v1.23.0 this is defined by `http.response.body.size`, which is experimental and opt-in.)
no change                           | The matched route (path template).
`url.scheme`                        | The URI scheme identifying the used protocol
`server.address`                    | The primary server name of the matched virtual host
`http.response.status_code`         | HTTP response status code
`url.path` and `url.query`          | The URI path and query component
`url.full`                          | Full HTTP request URL in the form `scheme://host[:port]/path?query[#fragment]`
`user_agent.original`               | Value of the HTTP User-Agent header sent by the client
`network.local.address`             | Like net.peer.ip but for the host IP. Useful in case of a multi-IP host
`server.address`                    | Local hostname or similar
`server.port`                       | Like net.peer.port but for the host port
`network.peer.address`              | Remote address of the peer (dotted decimal for IPv4 or RFC5952 for IPv6)
`server.address`                    | Server domain name if available without reverse DNS lookup
`server.port`                       | Server port number
`network.transport`                 | Transport protocol used

**Metrics:**

- [`http.server.request.duration`](https://github.com/open-telemetry/semantic-conventions/blob/v1.27.0/docs/http/http-metrics.md#metric-httpserverrequestduration)
- [`http.client.request.duration`](https://github.com/open-telemetry/semantic-conventions/blob/v1.27.0/docs/http/http-metrics.md#metric-httpclientrequestduration)

Versions of `@opentelemetry/instrumentation-http` to 0.221.0 used semantic conventions [v1.7.0](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.7.0/semantic_conventions/README.md) by default. Versions 0.54.0 - 0.220.0 supported [the `OTEL_SEMCONV_STABILITY_OPT_IN` environment variable for migrating from old to stable semantic conventions](https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/).

## Useful links

- For more information on OpenTelemetry, visit: <https://opentelemetry.io/>
- For more about OpenTelemetry JavaScript: <https://github.com/open-telemetry/opentelemetry-js>
- For help or feedback on this project, join us in [GitHub Discussions][discussions-url]

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[discussions-url]: https://github.com/open-telemetry/opentelemetry-js/discussions
[license-url]: https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE
[license-image]: https://img.shields.io/badge/license-Apache_2.0-green.svg?style=flat
[npm-url]: https://www.npmjs.com/package/@opentelemetry/instrumentation-http
[npm-img]: https://badge.fury.io/js/%40opentelemetry%2Finstrumentation-http.svg
