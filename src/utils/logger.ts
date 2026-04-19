/**
 * Logger Utility
 *
 * Wrapper around console that is no-op in production (except for errors).
 * In development, all levels are active.
 */

const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

const noop = (..._args: any[]): void => {};

const logger = {
  log: isDev ? console.log.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  debug: isDev ? console.debug.bind(console) : noop,
  // Errors are always logged
  error: console.error.bind(console),
};

export default logger;
