/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * System Configuration & Default Definitions
 * Standard Compliance: IEEE Std 830-1998 / WCAG 2.1 AA
 */

export const CONFIG = {
  VERSION: 'v4.0.0',
  API_TIMEOUT_MS: 15000,           // SRS-FR-005 & NFR-3: 15000ms client timeout threshold
  INPUT_DEBOUNCE_MS: 300,         // SRS-FR-001 & FR-1.2: 300ms input debounce
  POLL_INTERVAL_MS: 10000,        // Background GET reconciliation interval
  STORAGE_PREFIX: 'lunch_vote_',
  
  // Default Google Apps Script Web App Endpoint verified with Google Sheets
  DEFAULT_GAS_URL: 'https://script.google.com/macros/s/AKfycbzpfu9U3isk1tdUhePbjpjgaiMurFI2-AtHFg2LjL114cwUdrcBtqCWjs5qsetlPswuKg/exec',

  // 4 Fixed Menu Cards with Verified Korean Titles & High-Res Food Photos
  MENU_ITEMS: [
    {
      id: 'jeyuk',
      title: '제육볶음',
      subtitle: 'Jeyuk Bokkeum',
      desc: '매콤달콤 불맛 가득 든든한 직장인 소울푸드',
      image: 'images/jeyuk.jpg',
      emoji: '🥩',
      calories: '680 kcal'
    },
    {
      id: 'jajang',
      title: '짜장면',
      subtitle: 'Jajangmyeon',
      desc: '진한 춘장과 쫄깃한 면발의 중식 스테디셀러',
      image: 'images/jajang.jpg',
      emoji: '🍜',
      calories: '720 kcal'
    },
    {
      id: 'tonkatsu',
      title: '돈가스',
      subtitle: 'Tonkatsu',
      desc: '겉바속촉 두툼하고 바삭한 일식 수제 카츠',
      image: 'images/tonkatsu.jpg',
      emoji: '🍱',
      calories: '790 kcal'
    },
    {
      id: 'gukbap',
      title: '국밥',
      subtitle: 'Gukbap',
      desc: '뜨끈하고 깊은 진국 육수의 든든한 한 뚝배기',
      image: 'images/gukbap.jpg',
      emoji: '🍲',
      calories: '620 kcal'
    }
  ],

  // Fallback toast message on timeout >= 5000ms or lock exhaustion (SRS-FR-005)
  FALLBACK_TOAST_MESSAGE: '현재 대기자가 많습니다. 3초 후 다시 시도해 주세요.',

  // Storage Keys
  STORAGE_KEYS: {
    GAS_URL: 'lunch_gas_api_url',
    THEME: 'lunch_theme_preference',
    MOCK_MODE: 'lunch_mock_mode_enabled',
    FAUL_INJECTION: 'lunch_fault_injection_type', // 'none' | 'timeout' | 'lock_fail' | 'corrupt_data'
    LOCAL_TALLIES: 'lunch_mock_tallies'
  }
};
