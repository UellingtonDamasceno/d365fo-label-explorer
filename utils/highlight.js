/**
 * Text highlighting utility
 * Highlights search terms in text
 */

/**
 * Escape special regex characters
 * @param {string} string 
 * @returns {string}
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight search term in text
 * @param {string} text - Text to highlight
 * @param {string} term - Search term
 * @param {string} tag - HTML tag to use (default: 'mark')
 * @returns {string} - HTML string with highlighted term
 */
export function highlight(text, term, tag = 'mark') {
  if (!term || !text) {
    return escapeHtml(text || '');
  }

  const escapedTerm = escapeRegExp(term);
  const regex = new RegExp(`(${escapedTerm})`, 'gi');
  
  // Split text and wrap matches
  const parts = text.split(regex);
  
  return parts.map(part => {
    if (part.toLowerCase() === term.toLowerCase()) {
      return `<${tag}>${escapeHtml(part)}</${tag}>`;
    }
    return escapeHtml(part);
  }).join('');
}

/**
 * Escape HTML special characters
 * @param {string} text 
 * @returns {string}
 */
export function escapeHtml(text) {
  if (!text) return '';
  
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Truncate text with ellipsis
 * @param {string} text 
 * @param {number} maxLength 
 * @returns {string}
 */
export function truncate(text, maxLength = 200) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Highlight multiple terms in text
 * @param {string} text 
 * @param {Array<string>} terms 
 * @param {string} tag 
 * @returns {string}
 */
export function highlightMultiple(text, terms, tag = 'mark') {
  if (!terms || terms.length === 0 || !text) {
    return escapeHtml(text || '');
  }

  let result = text;
  
  // Sort terms by length (longest first) to avoid partial matches
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  
  sortedTerms.forEach(term => {
    if (term) {
      result = highlight(result, term, tag);
    }
  });
  
  return result;
}
