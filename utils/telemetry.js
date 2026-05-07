const TELEMETRY_PREFIX = '[Telemetry]';
const NOOP_TIMER = Object.freeze({ end: () => {} });

function isTelemetryEnabled() {
  try {
    return localStorage.getItem('ff_perf_telemetry') !== '0';
  } catch (_err) {
    return true;
  }
}

function getNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function bucketQueryLength(length) {
  const size = Math.max(0, Number(length) || 0);
  if (size === 0) return '0';
  if (size === 1) return '1';
  if (size <= 3) return '2-3';
  if (size <= 7) return '4-7';
  if (size <= 15) return '8-15';
  return '16+';
}

export function createTelemetryTimer(event, metadata = {}) {
  if (!isTelemetryEnabled()) return NOOP_TIMER;

  const startedAt = getNow();
  console.info(`${TELEMETRY_PREFIX} ${event}:start`, {
    ...metadata,
    timestamp: Date.now()
  });

  return {
    end(extra = {}) {
      const durationMs = Number((getNow() - startedAt).toFixed(2));
      console.info(`${TELEMETRY_PREFIX} ${event}:end`, {
        ...metadata,
        ...extra,
        durationMs,
        timestamp: Date.now()
      });
    }
  };
}
