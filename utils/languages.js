/**
 * Language Mapping Service
 * Uses Intl.DisplayNames API to convert culture codes to human-readable names
 */

// Fallback dictionary for codes that might not be resolved by Intl.DisplayNames
const FALLBACK_NAMES = {
  'en-us': 'English (United States)',
  'en-gb': 'English (United Kingdom)',
  'pt-br': 'Portuguese (Brazil)',
  'pt-pt': 'Portuguese (Portugal)',
  'es-mx': 'Spanish (Mexico)',
  'es-es': 'Spanish (Spain)',
  'fr-fr': 'French (France)',
  'fr-ca': 'French (Canada)',
  'de-de': 'German (Germany)',
  'de-at': 'German (Austria)',
  'it-it': 'Italian (Italy)',
  'ja-jp': 'Japanese (Japan)',
  'ko-kr': 'Korean (Korea)',
  'zh-cn': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)',
  'ru-ru': 'Russian (Russia)',
  'ar-sa': 'Arabic (Saudi Arabia)',
  'nl-nl': 'Dutch (Netherlands)',
  'pl-pl': 'Polish (Poland)',
  'tr-tr': 'Turkish (Turkey)',
  'sv-se': 'Swedish (Sweden)',
  'da-dk': 'Danish (Denmark)',
  'nb-no': 'Norwegian (Norway)',
  'fi-fi': 'Finnish (Finland)',
  'cs-cz': 'Czech (Czech Republic)',
  'hu-hu': 'Hungarian (Hungary)',
  'th-th': 'Thai (Thailand)',
  'vi-vn': 'Vietnamese (Vietnam)',
  'id-id': 'Indonesian (Indonesia)',
  'ms-my': 'Malay (Malaysia)',
  'he-il': 'Hebrew (Israel)',
  'uk-ua': 'Ukrainian (Ukraine)',
  'ro-ro': 'Romanian (Romania)',
  'bg-bg': 'Bulgarian (Bulgaria)',
  'hr-hr': 'Croatian (Croatia)',
  'sk-sk': 'Slovak (Slovakia)',
  'sl-si': 'Slovenian (Slovenia)',
  'et-ee': 'Estonian (Estonia)',
  'lv-lv': 'Latvian (Latvia)',
  'lt-lt': 'Lithuanian (Lithuania)'
};

// Cache for display names
let displayNamesCache = new Map();
let displayNamesInstance = null;
let forcedLocale = null;

/**
 * Initialize the display names instance
 * Uses browser's locale by default
 */
function getDisplayNamesInstance() {
  if (!displayNamesInstance) {
    try {
      // Use browser's preferred language for display
      const userLocale = forcedLocale || navigator.language || 'en';
      displayNamesInstance = new Intl.DisplayNames([userLocale], { 
        type: 'language',
        fallback: 'code'
      });
    } catch (e) {
      console.warn('Intl.DisplayNames not supported, using fallback');
      displayNamesInstance = null;
    }
  }
  return displayNamesInstance;
}

/**
 * Normalize culture code to standard format
 * Converts various formats (pt-br, PT-BR, pt_BR) to pt-BR
 * @param {string} code - Culture code
 * @returns {string} Normalized code
 */
export function normalizeCode(code) {
  if (!code) return '';
  
  // Replace underscores with hyphens
  let normalized = code.replace(/_/g, '-');
  
  // Split into parts
  const parts = normalized.split('-');
  
  if (parts.length === 1) {
    // Just language code (e.g., "en")
    return parts[0].toLowerCase();
  }
  
  if (parts.length >= 2) {
    // Language and region (e.g., "en-US")
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  
  return normalized.toLowerCase();
}

/**
 * Get human-readable language name for a culture code
 * @param {string} code - Culture code (e.g., 'pt-br', 'en-US')
 * @returns {string} Human-readable name
 */
export function getLanguageName(code) {
  if (!code) return 'Unknown';
  
  const normalized = normalizeCode(code);
  
  // Check cache first
  if (displayNamesCache.has(normalized)) {
    return displayNamesCache.get(normalized);
  }
  
  let displayName = null;
  
  // Try Intl.DisplayNames first
  const instance = getDisplayNamesInstance();
  if (instance) {
    try {
      displayName = instance.of(normalized);
      // Intl.DisplayNames returns the code if it can't resolve
      if (displayName === normalized || displayName === code) {
        displayName = null;
      }
    } catch (e) {
      displayName = null;
    }
  }
  
  // Fall back to our dictionary
  if (!displayName) {
    displayName = FALLBACK_NAMES[normalized.toLowerCase()] || normalized;
  }
  
  // Cache the result
  displayNamesCache.set(normalized, displayName);
  
  return displayName;
}

/**
 * Get short language name (just the language, not region)
 * @param {string} code - Culture code
 * @returns {string} Short language name
 */
export function getShortLanguageName(code) {
  if (!code) return 'Unknown';
  
  const normalized = normalizeCode(code);
  const langCode = normalized.split('-')[0];
  
  try {
    const instance = getDisplayNamesInstance();
    if (instance) {
      const name = instance.of(langCode);
      if (name && name !== langCode) {
        return name;
      }
    }
  } catch (e) {
    // Fall through to fallback
  }
  
  // Extract from fallback or return code
  const fullName = FALLBACK_NAMES[normalized.toLowerCase()];
  if (fullName) {
    return fullName.split('(')[0].trim();
  }
  
  return langCode.toUpperCase();
}

/**
 * Get language flag emoji (approximation based on region code)
 * @param {string} code - Culture code
 * @returns {string} Flag emoji or 🌐
 */
export function getLanguageFlag(code) {
  if (!code) return '🌐';
  
  const normalized = normalizeCode(code);
  const parts = normalized.split('-');
  
  if (parts.length < 2) {
    // No region code, use language-based mapping
    const langFlags = {
      'en': '🇬🇧',
      'pt': '🇧🇷',
      'es': '🇪🇸',
      'fr': '🇫🇷',
      'de': '🇩🇪',
      'it': '🇮🇹',
      'ja': '🇯🇵',
      'ko': '🇰🇷',
      'zh': '🇨🇳',
      'ru': '🇷🇺',
      'ar': '🇸🇦'
    };
    return langFlags[parts[0].toLowerCase()] || '🌐';
  }
  
  // Convert region code to flag emoji
  const regionCode = parts[1].toUpperCase();
  
  // Regional indicator symbols start at U+1F1E6 for 'A'
  try {
    const flag = regionCode
      .split('')
      .map(char => String.fromCodePoint(0x1F1E6 + char.charCodeAt(0) - 65))
      .join('');
    return flag;
  } catch (e) {
    return '🌐';
  }
}

/**
 * Format language display with flag and name
 * @param {string} code - Culture code
 * @param {Object} options - Display options
 * @returns {string} Formatted display string
 */
export function formatLanguageDisplay(code, options = {}) {
  const { showFlag = true, shortName = false } = options;
  
  const name = shortName ? getShortLanguageName(code) : getLanguageName(code);
  const flag = showFlag ? getLanguageFlag(code) : '';
  
  return flag ? `${flag} ${name}` : name;
}

/**
 * Clear the display names cache
 * Useful when user changes browser locale
 */
export function clearCache() {
  displayNamesCache.clear();
  displayNamesInstance = null;
}

/**
 * Force display locale for language names (or null for browser default)
 * @param {string|null} locale
 */
export function setDisplayLocale(locale) {
  forcedLocale = locale || null;
  clearCache();
}

export default {
  normalizeCode,
  getLanguageName,
  getShortLanguageName,
  getLanguageFlag,
  formatLanguageDisplay,
  clearCache,
  setDisplayLocale
};
