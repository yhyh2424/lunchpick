/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * State Management, Telemetry Store & Anti-Abuse Controller
 * Standard Compliance: IEEE Std 830-1998 / ISO/IEC/IEEE 29148 / WCAG 2.1 AA
 */

import { CONFIG } from './config.js';

export class VotingState {
  constructor() {
    // Local In-Memory State
    this.selectedMenuId = null;
    this.tallies = {
      jeyuk: 0,
      jajang: 0,
      tonkatsu: 0,
      gukbap: 0
    };
    this.isSubmitting = false;
    this.hasVotedToday = false;
    this.votedMenuId = null;
    this.lastRequestId = null;
    
    // Server Clock Drift Correction (SRS-FR-004 & FR-3.3)
    this.serverClockDriftMs = 0; // serverKstTime - localTime
    this.serverTimeKstStr = '';
    
    // Listeners for UI reactivity
    this.subscribers = [];

    // Initialize multi-tab synchronization (SRS-FR-004 & FR-3.4)
    this.initMultiTabSync();
  }

  /**
   * Subscribe a listener callback to state changes
   * @param {Function} callback 
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  notify() {
    const snapshot = this.getSnapshot();
    this.subscribers.forEach(cb => {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('Subscriber callback error:', err);
      }
    });
  }

  getSnapshot() {
    const totalVotes = Object.values(this.tallies).reduce((acc, count) => acc + count, 0);
    const topItem = this.calculateTopItem();

    return {
      selectedMenuId: this.selectedMenuId,
      tallies: { ...this.tallies },
      totalVotes,
      topItem,
      isSubmitting: this.isSubmitting,
      hasVotedToday: this.hasVotedToday,
      votedMenuId: this.votedMenuId,
      serverTimeKstStr: this.serverTimeKstStr,
      serverClockDriftMs: this.serverClockDriftMs,
      todayTokenKey: this.getTodayTokenKey()
    };
  }

  /**
   * Generates a UUID v4 string compliant with RFC 4122
   * @returns {string} UUIDv4
   */
  generateUUIDv4() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Calculates true KST Date taking into account server clock drift correction (FR-3.3)
   * Asia/Seoul is UTC+9 (540 minutes)
   * @returns {Date}
   */
  getAdjustedKstDate() {
    const now = new Date(Date.now() + this.serverClockDriftMs);
    // Convert to UTC+9 (KST)
    const utcEpoch = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstEpoch = utcEpoch + (9 * 60 * 60 * 1000);
    return new Date(kstEpoch);
  }

  /**
   * Formats KST date as YYYY-MM-DD
   * @returns {string} e.g. "2026-10-18"
   */
  getTodayKstDateString() {
    const kstDate = this.getAdjustedKstDate();
    const year = kstDate.getFullYear();
    const month = String(kstDate.getMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Token key for daily vote idempotency (SRS-FR-004: lunch_vote_token_YYYY-MM-DD)
   * @returns {string}
   */
  getTodayTokenKey() {
    const dateStr = this.getTodayKstDateString();
    return `lunch_vote_token_${dateStr}`;
  }

  /**
   * Syncs server clock and adjusts drift (FR-3.3)
   * @param {string|number} serverTimeKst ISO string or epoch millis
   */
  updateServerTimeDrift(serverTimeKst) {
    if (!serverTimeKst) return;
    try {
      const serverDate = new Date(serverTimeKst);
      if (!isNaN(serverDate.getTime())) {
        this.serverClockDriftMs = serverDate.getTime() - Date.now();
        this.serverTimeKstStr = serverDate.toLocaleTimeString('ko-KR', {
          timeZone: 'Asia/Seoul',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + ' KST';
        // Re-check voting state based on updated KST date
        this.checkDailyVoteStatus();
      }
    } catch (e) {
      console.warn('Clock drift calculation failed:', e);
    }
  }

  /**
   * Checks whether the user has voted today based on lunch_vote_token_YYYY-MM-DD
   */
  checkDailyVoteStatus() {
    const tokenKey = this.getTodayTokenKey();
    const existing = localStorage.getItem(tokenKey);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        this.hasVotedToday = true;
        this.votedMenuId = parsed.menuId || null;
      } catch {
        this.hasVotedToday = true;
        this.votedMenuId = existing;
      }
    } else {
      // 투표 상태가 아닐 때 불필요한 초기화로 득표수가 깨지지 않도록 분기 처리
      if (this.hasVotedToday) {
        this.hasVotedToday = false;
        this.votedMenuId = null;
      }
    }
    this.notify();
  }

  /**
   * Record local vote token for today
   * @param {string} menuId 
   * @param {string} requestId 
   */
  recordVoteLocally(menuId, requestId) {
    const tokenKey = this.getTodayTokenKey();
    const payload = {
      menuId,
      requestId,
      votedAt: new Date(Date.now() + this.serverClockDriftMs).toISOString()
    };
    localStorage.setItem(tokenKey, JSON.stringify(payload));
    this.hasVotedToday = true;
    this.votedMenuId = menuId;
    this.notify();
  }

  /**
   * Clear vote status (Used for testing/QA and demo resets)
   */
  resetDailyVoteForTesting() {
    const tokenKey = this.getTodayTokenKey();
    localStorage.removeItem(tokenKey);
    this.hasVotedToday = false;
    this.votedMenuId = null;
    this.notify();
  }

  /**
   * Select a menu item (single selection)
   * @param {string} menuId 
   */
  selectMenu(menuId) {
    if (this.hasVotedToday || this.isSubmitting) return;
    this.selectedMenuId = menuId;
    this.notify();
  }

  /**
   * SRS-FR-003: Defensive Telemetry & Null-Coalescing
   * Empty or non-numeric cells mapped to integer 0 (rendering as 0표)
   * @param {Object} rawTallies 
   */
  reconcileServerTallies(rawTallies) {
    if (!rawTallies || typeof rawTallies !== 'object') return;

    let hasChanges = false;
    CONFIG.MENU_ITEMS.forEach(item => {
      const rawVal = rawTallies[item.id];
      let safeInt = 0;
      if (typeof rawVal === 'number' && !isNaN(rawVal)) {
        safeInt = Math.max(0, Math.floor(rawVal));
      } else if (typeof rawVal === 'string' && rawVal.trim() !== '') {
        const parsed = parseInt(rawVal.trim(), 10);
        safeInt = isNaN(parsed) ? 0 : Math.max(0, parsed);
      }
      
      if (this.tallies[item.id] !== safeInt) {
        this.tallies[item.id] = safeInt;
        hasChanges = true;
      }
    });

    // 데이터 변화가 있거나 강제 동기화가 필요할 때 렌더링 트리거
    if (hasChanges || Object.values(this.tallies).every(v => v === 0)) {
      this.notify();
    }
  }

  /**
   * Optimistic UI update (SRS-FR-002 & NFR-1):
   * Increments local tally immediately (+1, 0ms perceived latency)
   * @param {string} menuId 
   * @returns {string} unique UUIDv4 requestId
   */
  optimisticIncrement(menuId) {
    if (!this.tallies[menuId]) {
      this.tallies[menuId] = 0;
    }
    this.tallies[menuId] += 1;
    this.isSubmitting = true;
    this.lastRequestId = this.generateUUIDv4();
    this.notify();
    return this.lastRequestId;
  }

  /**
   * Transactional Rollback (SRS-FR-005 & TC-ERR-001):
   * Triggered on timeout >= 5000ms or lock failure.
   * Decrements local tally by -1, clears submitting state, restores UI controls.
   * @param {string} menuId 
   */
  rollbackIncrement(menuId) {
    if (this.tallies[menuId] && this.tallies[menuId] > 0) {
      this.tallies[menuId] -= 1;
    }
    this.isSubmitting = false;
    this.notify();
  }

  /**
   * Finalize successful submission
   */
  finalizeSubmission(menuId, requestId) {
    this.isSubmitting = false;
    this.recordVoteLocally(menuId, requestId);
  }

  /**
   * Dynamic top-rank badge (FR-2.2: 1st Place)
   * Finds menu item with strictly highest vote tally
   * @returns {string|null} menuId of the leader, or null if all 0
   */
  calculateTopItem() {
    let max = 0;
    let leader = null;
    for (const [id, count] of Object.entries(this.tallies)) {
      if (count > max) {
        max = count;
        leader = id;
      }
    }
    return max > 0 ? leader : null;
  }

  /**
   * Multi-Tab Synchronization via window.addEventListener('storage', ...)
   * (SRS-FR-004 & FR-3.4)
   */
  initMultiTabSync() {
    window.addEventListener('storage', (event) => {
      // Check if another tab modified today's vote token
      const currentTokenKey = this.getTodayTokenKey();
      if (event.key === currentTokenKey) {
        this.checkDailyVoteStatus();
      }
      // Or if mock tallies changed in another tab
      if (event.key === CONFIG.STORAGE_KEYS.LOCAL_TALLIES && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          this.reconcileServerTallies(parsed);
        } catch {}
      }
    });

    // Check midnight rollover periodically (TC-EDGE-001)
    setInterval(() => {
      this.checkMidnightRollover();
    }, 30000); // Check every 30 seconds
  }

  /**
   * TC-EDGE-001: Midnight rollover check
   * When KST passes 00:00:00, new token key applies, resetting single-vote lock.
   */
  checkMidnightRollover() {
    this.checkDailyVoteStatus();
  }
}
