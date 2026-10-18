/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * Universal Bundle for zero-dependency execution across both file:// and http:// protocols
 */

(function () {
  'use strict';

  const CONFIG = {
    VERSION: 'v4.0.0',
    API_TIMEOUT_MS: 5000,
    INPUT_DEBOUNCE_MS: 300,
    POLL_INTERVAL_MS: 10000,
    STORAGE_PREFIX: 'lunch_vote_',
    
    DEFAULT_GAS_URL: 'https://script.google.com/macros/s/AKfycbzpfu9U3isk1tdUhePbjpjgaiMurFI2-AtHFg2LjL114cwUdrcBtqCWjs5qsetlPswuKg/exec',

    MENU_ITEMS: [
      { id: 'jeyuk', title: '제육볶음', subtitle: 'Jeyuk Bokkeum', desc: '매콤달콤 불맛 가득 든든한 직장인 소울푸드', image: 'images/jeyuk.jpg', emoji: '🥩', calories: '680 kcal' },
      { id: 'jajang', title: '짜장면', subtitle: 'Jajangmyeon', desc: '진한 춘장과 쫄깃한 면발의 중식 스테디셀러', image: 'images/jajang.jpg', emoji: '🍜', calories: '720 kcal' },
      { id: 'tonkatsu', title: '돈가스', subtitle: 'Tonkatsu', desc: '겉바속촉 두툼하고 바삭한 일식 수제 카츠', image: 'images/tonkatsu.jpg', emoji: '🍱', calories: '790 kcal' },
      { id: 'gukbap', title: '국밥', subtitle: 'Gukbap', desc: '뜨끈하고 깊은 진국 육수의 든든한 한 뚝배기', image: 'images/gukbap.jpg', emoji: '🍲', calories: '620 kcal' }
    ],

    FALLBACK_TOAST_MESSAGE: '현재 대기자가 많습니다. 3초 후 다시 시도해 주세요.',

    STORAGE_KEYS: {
      GAS_URL: 'lunch_gas_api_url',
      THEME: 'lunch_theme_preference',
      MOCK_MODE: 'lunch_mock_mode_enabled',
      FAUL_INJECTION: 'lunch_fault_injection_type',
      LOCAL_TALLIES: 'lunch_mock_tallies'
    }
  };

  class VotingState {
    constructor() {
      this.selectedMenuId = null;
      this.tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
      this.isSubmitting = false;
      this.hasVotedToday = false;
      this.votedMenuId = null;
      this.lastRequestId = null;
      this.serverClockDriftMs = 0;
      this.serverTimeKstStr = '';
      this.subscribers = [];
      this.initMultiTabSync();
    }

    subscribe(callback) {
      this.subscribers.push(callback);
      return () => { this.subscribers = this.subscribers.filter(cb => cb !== callback); };
    }

    notify() {
      const snapshot = this.getSnapshot();
      this.subscribers.forEach(cb => { try { cb(snapshot); } catch (err) {} });
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

    getAdjustedKstDate() {
      const now = new Date(Date.now() + this.serverClockDriftMs);
      const utcEpoch = now.getTime() + (now.getTimezoneOffset() * 60000);
      const kstEpoch = utcEpoch + (9 * 60 * 60 * 1000);
      return new Date(kstEpoch);
    }

    getTodayKstDateString() {
      const kstDate = this.getAdjustedKstDate();
      const year = kstDate.getFullYear();
      const month = String(kstDate.getMonth() + 1).padStart(2, '0');
      const day = String(kstDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    getTodayTokenKey() {
      return `lunch_vote_token_${this.getTodayKstDateString()}`;
    }

    updateServerTimeDrift(serverTimeKst) {
      if (!serverTimeKst) return;
      try {
        const serverDate = new Date(serverTimeKst);
        if (!isNaN(serverDate.getTime())) {
          this.serverClockDriftMs = serverDate.getTime() - Date.now();
          this.serverTimeKstStr = serverDate.toLocaleTimeString('ko-KR', {
            timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
          }) + ' KST';
          this.checkDailyVoteStatus();
        }
      } catch (e) {}
    }

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
        if (this.hasVotedToday) {
          this.hasVotedToday = false;
          this.votedMenuId = null;
        }
      }
      this.notify();
    }

    recordVoteLocally(menuId, requestId) {
      const tokenKey = this.getTodayTokenKey();
      const payload = {
        menuId, requestId, votedAt: new Date(Date.now() + this.serverClockDriftMs).toISOString()
      };
      localStorage.setItem(tokenKey, JSON.stringify(payload));
      this.hasVotedToday = true;
      this.votedMenuId = menuId;
      this.notify();
    }

    resetDailyVoteForTesting() {
      localStorage.removeItem(this.getTodayTokenKey());
      this.hasVotedToday = false;
      this.votedMenuId = null;
      this.notify();
    }

    selectMenu(menuId) {
      if (this.hasVotedToday || this.isSubmitting) return;
      this.selectedMenuId = menuId;
      this.notify();
    }

    reconcileServerTallies(rawTallies) {
      if (!rawTallies || typeof rawTallies !== 'object') return;
      CONFIG.MENU_ITEMS.forEach(item => {
        const rawVal = rawTallies[item.id];
        let safeInt = 0;
        if (typeof rawVal === 'number' && !isNaN(rawVal)) {
          safeInt = Math.max(0, Math.floor(rawVal));
        } else if (typeof rawVal === 'string' && rawVal.trim() !== '') {
          const parsed = parseInt(rawVal.trim(), 10);
          safeInt = isNaN(parsed) ? 0 : Math.max(0, parsed);
        }
        this.tallies[item.id] = safeInt;
      });
      this.notify();
    }

    optimisticIncrement(menuId) {
      if (!this.tallies[menuId]) this.tallies[menuId] = 0;
      this.tallies[menuId] += 1;
      this.isSubmitting = true;
      this.lastRequestId = this.generateUUIDv4();
      this.notify();
      return this.lastRequestId;
    }

    rollbackIncrement(menuId) {
      if (this.tallies[menuId] && this.tallies[menuId] > 0) {
        this.tallies[menuId] -= 1;
      }
      this.isSubmitting = false;
      this.notify();
    }

    finalizeSubmission(menuId, requestId) {
      this.isSubmitting = false;
      this.recordVoteLocally(menuId, requestId);
    }

    calculateTopItem() {
      let max = 0, leader = null;
      for (const [id, count] of Object.entries(this.tallies)) {
        if (count > max) { max = count; leader = id; }
      }
      return max > 0 ? leader : null;
    }

    initMultiTabSync() {
      window.addEventListener('storage', (event) => {
        if (event.key === this.getTodayTokenKey()) this.checkDailyVoteStatus();
      });
      setInterval(() => { this.checkDailyVoteStatus(); }, 30000);
    }
  }

  class ApiClient {
    constructor(state) {
      this.state = state;
      this.gasUrl = localStorage.getItem(CONFIG.STORAGE_KEYS.GAS_URL) || CONFIG.DEFAULT_GAS_URL || '';
      const storedMock = localStorage.getItem(CONFIG.STORAGE_KEYS.MOCK_MODE);
      this.isMockMode = storedMock === null ? false : storedMock === 'true';
      this.faultInjection = localStorage.getItem(CONFIG.STORAGE_KEYS.FAUL_INJECTION) || 'none';
      this.simulatedIdempotencyCache = new Map();
    }

    setGasUrl(url) {
      this.gasUrl = (url || '').trim();
      if (this.gasUrl) localStorage.setItem(CONFIG.STORAGE_KEYS.GAS_URL, this.gasUrl);
      else localStorage.removeItem(CONFIG.STORAGE_KEYS.GAS_URL);
    }

    setMockMode(enabled) {
      this.isMockMode = !!enabled;
      localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_MODE, String(this.isMockMode));
    }

    setFaultInjection(mode) {
      this.faultInjection = mode;
      localStorage.setItem(CONFIG.STORAGE_KEYS.FAUL_INJECTION, mode);
    }

    async resetTallies() {
      const zeroTallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
      if (this.gasUrl && !this.isMockMode) {
        try {
          await fetch(`${this.gasUrl}?action=resetTallies&t=${Date.now()}`, { method: 'GET' });
        } catch (e) {}
      }
      return zeroTallies;
    }

    async fetchTelemetry() {
      if (!this.gasUrl || this.isMockMode) return this.fetchMockTelemetry();
      const response = await fetch(`${this.gasUrl}?action=getTallies&t=${Date.now()}`, {
        method: 'GET', redirect: 'follow', cache: 'no-cache'
      });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    }

    async submitVote(menuId, requestId) {
      if (!this.gasUrl || this.isMockMode) return this.submitMockVote(menuId, requestId);
      const payload = { menuId: menuId, requestId: requestId };
      const response = await fetch(this.gasUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.status !== 'success') throw new Error(result.message || 'Server failed');
      return result;
    }

    async fetchMockTelemetry() {
      return { status: 'success', tallies: { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 } };
    }

    async submitMockVote(menuId, requestId) {
      return { status: 'success', tallies: { jeyuk: 1, jajang: 0, tonkatsu: 0, gukbap: 0 } };
    }
  }

  // (LunchVoteApp 및 기타 UI 바인딩 코드는 기존 bundle.js의 하단 로직을 그대로 유지하셔도 무방합니다.)
})();