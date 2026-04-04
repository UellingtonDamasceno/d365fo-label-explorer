/**
 * Toast notification utility
 * Displays temporary notifications to the user
 */

const TOAST_DURATION = 3000;
const TOAST_CONTAINER_ID = 'toast-container';

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'info'
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    console.warn('Toast container not found');
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = getIcon(type);
  
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, TOAST_DURATION);
}

/**
 * Get icon for toast type
 * @param {string} type 
 * @returns {string}
 */
function getIcon(type) {
  switch (type) {
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'info':
    default:
      return 'ℹ';
  }
}

/**
 * Escape HTML
 * @param {string} text 
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show success toast
 * @param {string} message 
 */
export function showSuccess(message) {
  showToast(message, 'success');
}

/**
 * Show error toast
 * @param {string} message 
 */
export function showError(message) {
  showToast(message, 'error');
}

/**
 * Show info toast
 * @param {string} message 
 */
export function showInfo(message) {
  showToast(message, 'info');
}
