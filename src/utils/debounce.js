/**
 * Debounce utility
 * Delays function execution until after wait milliseconds have elapsed
 * since the last time it was invoked
 */

/**
 * Create a debounced function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait = 300) {
  let timeoutId = null;

  const debounced = function(...args) {
    const context = this;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(context, args);
      timeoutId = null;
    }, wait);
  };

  // Allow canceling the debounce
  debounced.cancel = function() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

/**
 * Throttle utility
 * Ensures function is called at most once per wait milliseconds
 * @param {Function} func - Function to throttle
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} - Throttled function
 */
export function throttle(func, wait = 100) {
  let lastTime = 0;
  let timeoutId = null;

  return function(...args) {
    const context = this;
    const now = Date.now();

    if (now - lastTime >= wait) {
      func.apply(context, args);
      lastTime = now;
    } else {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        func.apply(context, args);
        lastTime = Date.now();
      }, wait - (now - lastTime));
    }
  };
}
