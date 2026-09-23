type LogContext = Record<string, string | number | boolean | null | undefined>;

export function logInfo(event: string, context: LogContext = {}) {
  console.info(JSON.stringify({ level: "info", event, ...context }));
}

export function logError(event: string, context: LogContext = {}) {
  console.error(JSON.stringify({ level: "error", event, ...context }));
}

