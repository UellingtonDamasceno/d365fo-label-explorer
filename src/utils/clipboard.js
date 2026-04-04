/**
 * Clipboard utilities
 * Handles copy to clipboard functionality
 */

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - True if successful
 */
export async function copyToClipboard(text) {
  try {
    // Modern Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Fallback for older browsers
    return fallbackCopy(text);
  } catch (err) {
    console.error('Copy failed:', err);
    return fallbackCopy(text);
  }
}

/**
 * Fallback copy using execCommand
 * @param {string} text 
 * @returns {boolean}
 */
function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // Make it invisible
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '-9999px';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    document.body.removeChild(textArea);
    return false;
  }
}

/**
 * Copy label ID to clipboard
 * @param {string} fullId - Full label ID (e.g., @GSC:CustomerName)
 * @returns {Promise<boolean>}
 */
export async function copyLabelId(fullId) {
  return copyToClipboard(fullId);
}

/**
 * Copy label text to clipboard
 * @param {string} text - Label text
 * @returns {Promise<boolean>}
 */
export async function copyLabelText(text) {
  return copyToClipboard(text);
}
