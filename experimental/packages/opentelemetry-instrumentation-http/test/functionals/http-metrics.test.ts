/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_NETWORK_PROTOCOL_VERSION,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_SCHEME,
} from '@opentelemetry/semantic-conventions';
import * as assert from 'assert';
import { HttpInstrumentation } from '../../src/http';
import { httpRequest } from '../utils/httpRequest';
import { TestMetricReader } from '../utils/TestMetricReader';
import type { Attributes, ContextManager } from '@opentelemetry/api';
import { context, diag, DiagLogLevel } from '@opentelemetry/api';
import type {
  HttpClientMetricAttributesHookInfo,
  HttpServerMetricAttributesHookInfo,
} from '../../src/types';

const instrumentation = new HttpInstrumentation();
instrumentation.enable();
instrumentation.disable();

import * as http from 'http';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';

let server: http.Server;
const serverPort = 22346;
/** A port nothing listens on, used to exercise the client error path. */
const unusedPort = 22347;
const protocol = 'http';
const hostname = 'localhost';
const pathname = '/test';
const tracerProvider = new TracerProvider();
const metricsMemoryExporter = new InMemoryMetricExporter(
  AggregationTemporality.DELTA
);
const metricReader = new TestMetricReader(metricsMemoryExporter);
const meterProvider = new MeterProvider({ readers: [metricReader] });

instrumentation.setTracerProvider(tracerProvider);
instrumentation.setMeterProvider(meterProvider);

describe('metrics', () => {
  let contextManager: ContextManager;

  beforeEach(() => {
    contextManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(contextManager);
    instrumentation['_updateMetricInstruments']();
    metricsMemoryExporter.reset();
  });

  before(() => {
    instrumentation.setConfig({});
    instrumentation.enable();
    server = http.createServer((request, response) => {
      const rpcData = getRPCMetadata(context.active());
      assert.ok(rpcData != null);
      assert.strictEqual(rpcData.type, RPCType.HTTP);
      assert.strictEqual(rpcData.route, undefined);
      rpcData.route = 'TheRoute';
      if (request.url?.endsWith('/error/client')) {
        response.statusCode = 400;
      } else if (request.url?.endsWith('/error/server')) {
        response.statusCode = 500;
      }
      response.end('Test Server Response');
    });
    server.listen(serverPort);
  });

  after(() => {
    server.close();
    instrumentation.disable();
  });
  describe('with stable semconv', () => {
    it('should add server/client duration metrics', async () => {
      const requestCount = 3;
      for (let i = 0; i < requestCount; i++) {
        await httpRequest.get(
          `${protocol}://${hostname}:${serverPort}${pathname}`
        );
      }
      await metricReader.collectAndExport();
      let resourceMetrics = metricsMemoryExporter.getMetrics();
      let scopeMetrics = resourceMetrics[0].scopeMetrics;
      assert.strictEqual(scopeMetrics.length, 1, 'scopeMetrics count');
      let metrics = scopeMetrics[0].metrics;
      assert.strictEqual(metrics.length, 2, 'metrics count');
      assert.strictEqual(metrics[0].dataPointType, DataPointType.HISTOGRAM);
      assert.strictEqual(
        metrics[0].descriptor.description,
        'Duration of HTTP server requests.'
      );
      assert.strictEqual(
        metrics[0].descriptor.name,
        'http.server.request.duration'
      );
      assert.strictEqual(metrics[0].descriptor.unit, 's');
      assert.strictEqual(metrics[0].dataPoints.length, 1);
      assert.strictEqual(
        (metrics[0].dataPoints[0].value as any).count,
        requestCount
      );
      assert.deepStrictEqual(metrics[0].dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });

      assert.strictEqual(metrics[1].dataPointType, DataPointType.HISTOGRAM);
      assert.strictEqual(
        metrics[1].descriptor.description,
        'Duration of HTTP client requests.'
      );
      assert.strictEqual(
        metrics[1].descriptor.name,
        'http.client.request.duration'
      );
      assert.strictEqual(metrics[1].descriptor.unit, 's');
      assert.strictEqual(metrics[1].dataPoints.length, 1);
      assert.strictEqual(
        (metrics[1].dataPoints[0].value as any).count,
        requestCount
      );

      assert.deepStrictEqual(metrics[1].dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: 22346,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      });

      metricsMemoryExporter.reset();

      assert.throws(() =>
        http.request({
          hostname,
          port: serverPort,
          pathname,
          headers: { cookie: undefined },
        })
      );

      await metricReader.collectAndExport();
      resourceMetrics = metricsMemoryExporter.getMetrics();
      scopeMetrics = resourceMetrics[0].scopeMetrics;
      assert.strictEqual(scopeMetrics.length, 1, 'scopeMetrics count');
      metrics = scopeMetrics[0].metrics;
      assert.strictEqual(metrics.length, 1, 'metrics count');
      assert.strictEqual(metrics[0].dataPointType, DataPointType.HISTOGRAM);
      assert.strictEqual(
        metrics[0].descriptor.description,
        'Duration of HTTP client requests.'
      );
      assert.strictEqual(
        metrics[0].descriptor.name,
        'http.client.request.duration'
      );
      assert.strictEqual(metrics[0].descriptor.unit, 's');
      assert.strictEqual(metrics[0].dataPoints.length, 1);
      assert.strictEqual((metrics[0].dataPoints[0].value as any).count, 1);

      assert.deepStrictEqual(metrics[0].dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: 22346,
        [ATTR_ERROR_TYPE]: 'TypeError',
      });
    });

    it('should set error type attribute on metrics for client/server errors', async () => {
      await httpRequest.get(
        `${protocol}://${hostname}:${serverPort}${pathname}/error/client`
      );
      await httpRequest.get(
        `${protocol}://${hostname}:${serverPort}${pathname}/error/server`
      );

      await metricReader.collectAndExport();
      const resourceMetrics = metricsMemoryExporter.getMetrics();
      const scopeMetrics = resourceMetrics[0].scopeMetrics;
      assert.strictEqual(scopeMetrics.length, 1, 'scopeMetrics count');
      const metrics = scopeMetrics[0].metrics;
      assert.strictEqual(metrics.length, 2, 'metrics count');

      assert.strictEqual(metrics[0].dataPointType, DataPointType.HISTOGRAM);
      assert.strictEqual(
        metrics[0].descriptor.description,
        'Duration of HTTP server requests.'
      );
      assert.strictEqual(
        metrics[0].descriptor.name,
        'http.server.request.duration'
      );
      assert.strictEqual(metrics[0].descriptor.unit, 's');
      assert.strictEqual(metrics[0].dataPoints.length, 2);
      assert.strictEqual((metrics[0].dataPoints[0].value as any).count, 1);
      assert.strictEqual((metrics[0].dataPoints[1].value as any).count, 1);
      assert.deepStrictEqual(metrics[0].dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 400,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });
      assert.deepStrictEqual(metrics[0].dataPoints[1].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 500,
        [ATTR_ERROR_TYPE]: '500',
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });

      assert.strictEqual(metrics[1].dataPointType, DataPointType.HISTOGRAM);
      assert.strictEqual(
        metrics[1].descriptor.description,
        'Duration of HTTP client requests.'
      );
      assert.strictEqual(
        metrics[1].descriptor.name,
        'http.client.request.duration'
      );
      assert.strictEqual(metrics[1].descriptor.unit, 's');
      assert.strictEqual(metrics[1].dataPoints.length, 2);
      assert.strictEqual((metrics[1].dataPoints[0].value as any).count, 1);
      assert.strictEqual((metrics[1].dataPoints[1].value as any).count, 1);
      assert.deepStrictEqual(metrics[1].dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: 22346,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 400,
        [ATTR_ERROR_TYPE]: '400',
      });
      assert.deepStrictEqual(metrics[1].dataPoints[1].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: 22346,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 500,
        [ATTR_ERROR_TYPE]: '500',
      });
    });
  });

  describe('metric attributes hooks', () => {
    const url = `${protocol}://${hostname}:${serverPort}${pathname}`;

    beforeEach(async () => {
      // Drain any measurement recorded by a previous test that was never
      // collected, so `dataPoints` below only contains this test's data.
      await metricReader.collectAndExport();
      metricsMemoryExporter.reset();
    });

    afterEach(() => {
      instrumentation.setConfig({});
      diag.disable();
    });

    /** Collects and returns the two duration metrics by name. */
    async function collectDurationMetrics() {
      await metricReader.collectAndExport();
      const metrics =
        metricsMemoryExporter.getMetrics()[0].scopeMetrics[0].metrics;
      return {
        server: metrics.find(
          m => m.descriptor.name === 'http.server.request.duration'
        ),
        client: metrics.find(
          m => m.descriptor.name === 'http.client.request.duration'
        ),
      };
    }

    it('should pass the computed attributes and the request/response to the server hook', async () => {
      const calls: Array<{
        attributes: Attributes;
        info: HttpServerMetricAttributesHookInfo;
      }> = [];

      instrumentation.setConfig({
        serverMetricAttributesHook: (attributes, info) => {
          calls.push({ attributes, info });
          return undefined;
        },
      });

      await httpRequest.get(url);

      assert.strictEqual(calls.length, 1, 'hook called exactly once');
      // The hook sees everything the instrumentation computed, including the
      // response-derived attributes.
      assert.deepStrictEqual(calls[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });
      assert.strictEqual(calls[0].info.request.method, 'GET');
      assert.strictEqual(calls[0].info.request.url, pathname);
      // Status code is known by the time the hook runs.
      assert.strictEqual(calls[0].info.response.statusCode, 200);
      assert.strictEqual(calls[0].info.response.writableEnded, true);
    });

    it('should pass the computed attributes and the request/response to the client hook', async () => {
      const calls: Array<{
        attributes: Attributes;
        info: HttpClientMetricAttributesHookInfo;
      }> = [];

      instrumentation.setConfig({
        clientMetricAttributesHook: (attributes, info) => {
          calls.push({ attributes, info });
          return undefined;
        },
      });

      await httpRequest.get(url);

      assert.strictEqual(calls.length, 1, 'hook called exactly once');
      assert.deepStrictEqual(calls[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: serverPort,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      });
      assert.strictEqual(calls[0].info.request.method, 'GET');
      assert.strictEqual(calls[0].info.request.path, pathname);
      assert.strictEqual(calls[0].info.response?.statusCode, 200);
    });

    it('should add the returned attributes to the recorded metrics', async () => {
      instrumentation.setConfig({
        serverMetricAttributesHook: () => ({ 'acme.privileged': true }),
        clientMetricAttributesHook: () => ({ 'acme.tier': 'internal' }),
      });

      await httpRequest.get(url);
      const { server, client } = await collectDurationMetrics();

      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
        'acme.privileged': true,
      });
      assert.deepStrictEqual(client?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: serverPort,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        'acme.tier': 'internal',
      });
    });

    it('should split the metric into separate data points per returned attribute value', async () => {
      let privileged = false;
      instrumentation.setConfig({
        serverMetricAttributesHook: () => ({ 'acme.privileged': privileged }),
      });

      await httpRequest.get(url);
      privileged = true;
      await httpRequest.get(url);

      const { server } = await collectDurationMetrics();
      assert.strictEqual(server?.dataPoints.length, 2);
      assert.deepStrictEqual(
        server.dataPoints.map(dp => dp.attributes['acme.privileged']),
        [false, true]
      );
    });

    it('should record the unmodified attributes when no hook is configured', async () => {
      instrumentation.setConfig({});

      await httpRequest.get(url);
      const { server, client } = await collectDurationMetrics();

      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });
      assert.deepStrictEqual(client?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: serverPort,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      });
    });

    it('should be a no-op when a hook returns undefined', async () => {
      instrumentation.setConfig({
        serverMetricAttributesHook: () => undefined,
        clientMetricAttributesHook: () => {
          // returns void
        },
      });

      await httpRequest.get(url);
      const { server, client } = await collectDurationMetrics();

      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });
      assert.deepStrictEqual(client?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: serverPort,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      });
    });

    it('should ignore mutations a hook makes to the attributes it is given', async () => {
      instrumentation.setConfig({
        serverMetricAttributesHook: attributes => {
          attributes[ATTR_HTTP_ROUTE] = 'MutatedRoute';
          attributes['acme.mutated'] = true;
          return undefined;
        },
      });

      await httpRequest.get(url);
      const { server } = await collectDurationMetrics();

      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });
    });

    it('should drop returned attributes that collide with instrumentation-computed keys and warn', async () => {
      const warnings: string[] = [];
      diag.setLogger(
        {
          verbose: () => {},
          debug: () => {},
          info: () => {},
          // The component logger prepends its namespace as the first argument.
          warn: (...args) => warnings.push(args.join(' ')),
          error: () => {},
        },
        DiagLogLevel.WARN
      );

      instrumentation.setConfig({
        serverMetricAttributesHook: () => ({
          [ATTR_HTTP_ROUTE]: 'HijackedRoute',
          [ATTR_HTTP_RESPONSE_STATUS_CODE]: 599,
          'acme.privileged': true,
        }),
      });

      await httpRequest.get(url);
      const { server } = await collectDurationMetrics();

      // Semconv attributes keep the instrumentation's values; only the
      // non-colliding attribute is added.
      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
        'acme.privileged': true,
      });
      assert.strictEqual(
        warnings.filter(w => w.includes('reserved attribute')).length,
        2,
        'one warning per dropped attribute'
      );
    });

    it('should not break the request or lose the metric when a hook throws', async () => {
      instrumentation.setConfig({
        serverMetricAttributesHook: () => {
          throw new Error('server hook boom');
        },
        clientMetricAttributesHook: () => {
          throw new Error('client hook boom');
        },
      });

      const result = await httpRequest.get(url);
      assert.strictEqual(result.data, 'Test Server Response');

      const { server, client } = await collectDurationMetrics();

      // Metrics are still recorded, with the computed attributes untouched.
      assert.strictEqual((server?.dataPoints[0].value as any).count, 1);
      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
      });
      assert.strictEqual((client?.dataPoints[0].value as any).count, 1);
      assert.deepStrictEqual(client?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_SERVER_ADDRESS]: 'localhost',
        [ATTR_SERVER_PORT]: serverPort,
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      });
    });

    it('should call the client hook with an undefined response when the request errors', async () => {
      const calls: HttpClientMetricAttributesHookInfo[] = [];
      instrumentation.setConfig({
        clientMetricAttributesHook: (_attributes, info) => {
          calls.push(info);
          return { 'acme.errored': info.response === undefined };
        },
      });

      // Nothing is listening on this port, so the request errors before any
      // response arrives.
      await assert.rejects(
        httpRequest.get(`${protocol}://${hostname}:${unusedPort}${pathname}`)
      );

      const { client } = await collectDurationMetrics();

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].response, undefined);
      assert.strictEqual(calls[0].request.method, 'GET');
      assert.strictEqual(calls[0].request.path, pathname);
      assert.strictEqual(
        client?.dataPoints[0].attributes['acme.errored'],
        true
      );
      assert.strictEqual(
        client?.dataPoints[0].attributes[ATTR_ERROR_TYPE],
        'Error'
      );
    });

    it('should apply the server hook to metrics recorded for errored responses', async () => {
      instrumentation.setConfig({
        serverMetricAttributesHook: (attributes, info) => ({
          'acme.status_class': `${Math.floor(
            (info.response.statusCode ?? 0) / 100
          )}xx`,
        }),
      });

      await httpRequest.get(`${url}/error/server`);
      const { server } = await collectDurationMetrics();

      assert.deepStrictEqual(server?.dataPoints[0].attributes, {
        [ATTR_HTTP_REQUEST_METHOD]: 'GET',
        [ATTR_URL_SCHEME]: 'http',
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: 500,
        [ATTR_ERROR_TYPE]: '500',
        [ATTR_NETWORK_PROTOCOL_VERSION]: '1.1',
        [ATTR_HTTP_ROUTE]: 'TheRoute',
        'acme.status_class': '5xx',
      });
    });
  });
});
