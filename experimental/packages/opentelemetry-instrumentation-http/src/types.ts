/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Span, Attributes } from '@opentelemetry/api';
import type {
  ClientRequest,
  IncomingMessage,
  ServerResponse,
  RequestOptions,
} from 'http';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';

export interface HttpCustomAttributeFunction {
  (
    span: Span,
    request: ClientRequest | IncomingMessage,
    response: IncomingMessage | ServerResponse
  ): void;
}

/**
 * Called with each incoming request. Return `true` to skip creating a server
 * span for that request.
 */
export interface IgnoreIncomingRequestFunction {
  (request: IncomingMessage): boolean;
}

/**
 * Called with each outgoing request's parsed options. Return `true` to skip
 * creating a client span for that request.
 */
export interface IgnoreOutgoingRequestFunction {
  (request: RequestOptions): boolean;
}

/**
 * Called with the active span and request before the request is handled.
 */
export interface HttpRequestCustomAttributeFunction {
  (span: Span, request: ClientRequest | IncomingMessage): void;
}

/**
 * Called with the active span and response before the response is handled.
 */
export interface HttpResponseCustomAttributeFunction {
  (span: Span, response: IncomingMessage | ServerResponse): void;
}

/**
 * Called before an incoming request span is started. Returned attributes are
 * added to the new server span.
 */
export interface StartIncomingSpanCustomAttributeFunction {
  (request: IncomingMessage): Attributes;
}

/**
 * Called with an outgoing request's parsed options before the span is started.
 * Returned attributes are added to the new client span.
 */
export interface StartOutgoingSpanCustomAttributeFunction {
  (request: RequestOptions): Attributes;
}

/**
 * The request/response pair a server metric attributes hook is called with.
 */
export interface HttpServerMetricAttributesHookInfo {
  request: IncomingMessage;
  response: ServerResponse;
}

/**
 * The request/response pair a client metric attributes hook is called with.
 *
 * `response` is `undefined` when the metric is recorded for a request that
 * never produced a response (for example an aborted request, a socket error,
 * or a DNS failure).
 */
export interface HttpClientMetricAttributesHookInfo {
  request: ClientRequest;
  response?: IncomingMessage;
}

/**
 * Called once per recorded `http.server.request.duration` measurement, right
 * before it is recorded, with the attributes the instrumentation computed.
 * Returned attributes are added to that measurement.
 *
 * Keys that the instrumentation already computed are **not** overridable: a
 * returned key that collides with one of them is dropped and a warning is
 * logged via `diag`. Returning `undefined` (or mutating the passed
 * `attributes` object, which is a copy) adds nothing.
 *
 * > **Keep the returned attributes low cardinality.** Every distinct
 * > combination of attribute values creates a separate metric time series in
 * > the backend, and the memory held by the SDK grows with it. Return
 * > booleans or small closed enums whose value set you control. Never return
 * > raw header values, user or session IDs, request URLs or paths, query
 * > parameters, IP addresses, or anything else derived from untrusted input —
 * > a single such attribute is enough to exhaust the metric cardinality limit
 * > and make the metric useless.
 */
export interface HttpServerMetricCustomAttributeFunction {
  (
    attributes: Attributes,
    info: HttpServerMetricAttributesHookInfo
  ): Attributes | void;
}

/**
 * Called once per recorded `http.client.request.duration` measurement, right
 * before it is recorded, with the attributes the instrumentation computed.
 * Returned attributes are added to that measurement.
 *
 * Keys that the instrumentation already computed are **not** overridable: a
 * returned key that collides with one of them is dropped and a warning is
 * logged via `diag`. Returning `undefined` (or mutating the passed
 * `attributes` object, which is a copy) adds nothing.
 *
 * > **Keep the returned attributes low cardinality.** See
 * > {@link HttpServerMetricCustomAttributeFunction} for the full warning.
 */
export interface HttpClientMetricCustomAttributeFunction {
  (
    attributes: Attributes,
    info: HttpClientMetricAttributesHookInfo
  ): Attributes | void;
}

/**
 * Options available for the HTTP instrumentation (see [documentation](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation-http#http-instrumentation-options))
 */
export interface HttpInstrumentationConfig extends InstrumentationConfig {
  /** Do not trace incoming requests for which this function returns `true`. */
  ignoreIncomingRequestHook?: IgnoreIncomingRequestFunction;
  /** Do not trace outgoing requests for which this function returns `true`. */
  ignoreOutgoingRequestHook?: IgnoreOutgoingRequestFunction;
  /** If set to true, incoming requests will not be instrumented at all. */
  disableIncomingRequestInstrumentation?: boolean;
  /** If set to true, outgoing requests will not be instrumented at all. */
  disableOutgoingRequestInstrumentation?: boolean;
  /** Function for adding custom attributes after response is handled */
  applyCustomAttributesOnSpan?: HttpCustomAttributeFunction;
  /** Function for adding custom attributes before request is handled */
  requestHook?: HttpRequestCustomAttributeFunction;
  /** Function for adding custom attributes before response is handled */
  responseHook?: HttpResponseCustomAttributeFunction;
  /** Function for adding custom attributes before a span is started in incomingRequest */
  startIncomingSpanHook?: StartIncomingSpanCustomAttributeFunction;
  /** Function for adding custom attributes before a span is started in outgoingRequest */
  startOutgoingSpanHook?: StartOutgoingSpanCustomAttributeFunction;
  /**
   * Function for adding custom attributes to the `http.server.request.duration`
   * metric, called once per recorded measurement.
   *
   * The returned attributes are **added to**, and cannot replace, the
   * attributes the instrumentation computed. Returned attributes must be low
   * cardinality; see {@link HttpServerMetricCustomAttributeFunction}.
   *
   * @experimental
   */
  serverMetricAttributesHook?: HttpServerMetricCustomAttributeFunction;
  /**
   * Function for adding custom attributes to the `http.client.request.duration`
   * metric, called once per recorded measurement.
   *
   * The returned attributes are **added to**, and cannot replace, the
   * attributes the instrumentation computed. Returned attributes must be low
   * cardinality; see {@link HttpServerMetricCustomAttributeFunction}.
   *
   * @experimental
   */
  clientMetricAttributesHook?: HttpClientMetricCustomAttributeFunction;
  /**
   * The primary server name of the matched virtual host.
   * @deprecated No longer used. Stable HTTP semantic conventions do not include
   * the `http.server_name` attribute; this option has no effect.
   */
  serverName?: string;
  /** Require parent to create span for outgoing requests */
  requireParentforOutgoingSpans?: boolean;
  /** Require parent to create span for incoming requests */
  requireParentforIncomingSpans?: boolean;
  /** Map the following HTTP headers to span attributes. */
  headersToSpanAttributes?: {
    client?: { requestHeaders?: string[]; responseHeaders?: string[] };
    server?: { requestHeaders?: string[]; responseHeaders?: string[] };
  };
  /**
   * Enable automatic population of synthetic source type based on the user-agent header
   * @experimental
   **/
  enableSyntheticSourceDetection?: boolean;
  /**
   * [Optional] Additional query parameters to redact.
   * Use this to specify custom query strings that contain sensitive information.
   * These will replace/overwrite the default query strings that are to be redacted.
   * @example default strings ['sig','Signature','AWSAccessKeyId','X-Goog-Signature']
   * @experimental
   */
  redactedQueryParams?: string[];
}
