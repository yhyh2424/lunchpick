/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * Universal Bundle for zero-dependency execution across both file:// and http:// protocols
 * Standard Compliance: IEEE Std 830-1998 / ISO/IEC/IEEE 29148 / ISO/IEC/IEEE 29119 / WCAG 2.1 AA
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Configuration (CONFIG)
  // =========================================================================
  const CONFIG = {
    VERSION: 'v4.0.0',
    API_TIMEOUT_MS: 5000,           // SRS-FR-005 & NFR-3: 5000ms client timeout threshold
    INPUT_DEBOUNCE_MS: 300,         // SRS-FR-001 & FR-1.2: 300ms input debounce
    POLL_INTERVAL_MS: 10000,        // Background GET reconciliation interval
    STORAGE_PREFIX: 'lunch_vote_',
    
    // Default Google Apps Script Web App Endpoint verified with Google Sheets
    DEFAULT_GAS_URL: 'https://script.google.com/macros/s/AKfycbzpfu9U3isk1tdUhePbjpjgaiMurFI2-AtHFg2LjL114cwUdrcBtqCWjs5qsetlPswuKg/exec',

    // 4 Fixed Menu Cards (PRD FR-1.1 & US-01)
    MENU_ITEMS: [
      {
        id: 'jeyuk',
        title: '제육볶음',
        subtitle: 'Jeyuk Bokkeum',
        desc: '매콤달콤 불맛 가득 든든한 한식',
        image: 'images/jeyuk.jpg',
        emoji: '🥩',
        calories: '680 kcal'
      },
      {
        id: 'jajang',
        title: '짜장면',
        subtitle: 'Jajangmyeon',
        desc: '진한 춘장과 쫄깃한 면발의 중식',
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
        desc: '뜨끈하고 깊은 육수의 든든한 뚝배기',
        image: 'images/gukbap.jpg',
        emoji: '🍲',
        calories: '620 kcal'
      }
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

  // =========================================================================
  // 2. Voting State Management (VotingState)
  // =========================================================================
  class VotingState {
    constructor() {
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
      this.serverClockDriftMs = 0;
      this.serverTimeKstStr = '';
      this.subscribers = [];

      this.initMultiTabSync();
    }

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
      const dateStr = this.getTodayKstDateString();
      return `lunch_vote_token_${dateStr}`;
    }

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
          this.checkDailyVoteStatus();
        }
      } catch (e) {
        console.warn('Clock drift calculation failed:', e);
      }
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
        this.hasVotedToday = false;
        this.votedMenuId = null;
      }
      this.notify();
    }

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

    resetDailyVoteForTesting() {
      const tokenKey = this.getTodayTokenKey();
      localStorage.removeItem(tokenKey);
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
      if (!this.tallies[menuId]) {
        this.tallies[menuId] = 0;
      }
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
      let max = 0;
      for (const count of Object.values(this.tallies)) {
        if (count > max) max = count;
      }
      if (max === 0) return [];
      return Object.entries(this.tallies)
        .filter(([, count]) => count === max)
        .map(([id]) => id);
    }

    initMultiTabSync() {
      window.addEventListener('storage', (event) => {
        const currentTokenKey = this.getTodayTokenKey();
        if (event.key === currentTokenKey) {
          this.checkDailyVoteStatus();
        }
        if (event.key === CONFIG.STORAGE_KEYS.LOCAL_TALLIES && event.newValue) {
          try {
            const parsed = JSON.parse(event.newValue);
            this.reconcileServerTallies(parsed);
          } catch {}
        }
      });

      setInterval(() => {
        this.checkMidnightRollover();
      }, 30000);
    }

    checkMidnightRollover() {
      this.checkDailyVoteStatus();
    }
  }

  // =========================================================================
  // 3. API Client & Mock Engine (ApiClient)
  // =========================================================================
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
      if (this.gasUrl) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.GAS_URL, this.gasUrl);
      } else {
        localStorage.removeItem(CONFIG.STORAGE_KEYS.GAS_URL);
      }
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
      const todayKst = this.state.getTodayKstDateString();
      const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
      const zeroTallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
      localStorage.setItem(dateKey, JSON.stringify(zeroTallies));
      localStorage.removeItem(CONFIG.STORAGE_KEYS.LOCAL_TALLIES);

      if (this.gasUrl && !this.isMockMode) {
        try {
          await fetch(`${this.gasUrl}?action=resetTallies&t=${Date.now()}`, { method: 'GET' });
        } catch (e) {
          console.warn('GAS reset request error:', e);
        }
      }
      return zeroTallies;
    }

        async cancelVote(menuId) {
      if (!menuId) return;

      if (!this.gasUrl || this.isMockMode) {
        const todayKst = this.state.getTodayKstDateString();
        const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
        let stored = localStorage.getItem(dateKey);
        let tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
        if (stored) {
          try { tallies = JSON.parse(stored); } catch {}
        }
        tallies[menuId] = Math.max(0, (tallies[menuId] || 0) - 1);
        localStorage.setItem(dateKey, JSON.stringify(tallies));
        return { status: 'success', tallies };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
      try {
        const payload = { action: 'cancelVote', menuId };
        const response = await fetch(this.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('cancelVote GAS error:', err);
        return null;
      }
    }

    async cancelVote(menuId) {
      if (!menuId) return;

      if (!this.gasUrl || this.isMockMode) {
        const todayKst = this.state.getTodayKstDateString();
        const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
        let stored = localStorage.getItem(dateKey);
        let tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
        if (stored) {
          try { tallies = JSON.parse(stored); } catch {}
        }
        tallies[menuId] = Math.max(0, (tallies[menuId] || 0) - 1);
        localStorage.setItem(dateKey, JSON.stringify(tallies));
        return { status: 'success', tallies };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
      try {
        const payload = { action: 'cancelVote', menuId };
        const response = await fetch(this.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('cancelVote GAS error:', err);
        return null;
      }
    }

    async fetchTelemetry() {
      if (!this.gasUrl || this.isMockMode) {
        return this.fetchMockTelemetry();
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

      try {
        const response = await fetch(`${this.gasUrl}?action=getTallies&t=${Date.now()}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    async submitVote(menuId, requestId) {
      if (!this.gasUrl || this.isMockMode) {
        return this.submitMockVote(menuId, requestId);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

      try {
        const payload = {
          action: 'vote',
          menuId,
          requestId,
          clientTimestamp: Date.now()
        };

        const response = await fetch(this.gasUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}: Vote Submission Failed`);
        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.message || 'Server increment failed');
        }
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    async fetchMockTelemetry() {
      await new Promise(res => setTimeout(res, 120));

      const now = new Date();
      const utcEpoch = now.getTime() + (now.getTimezoneOffset() * 60000);
      const kstEpoch = utcEpoch + (9 * 60 * 60 * 1000);
      const serverTimeKst = new Date(kstEpoch).toISOString();

      if (this.faultInjection === 'corrupt_data') {
        return {
          status: 'success',
          server_time_kst: serverTimeKst,
          tallies: {
            jeyuk: null,
            jajang: 'INVALID_STR',
            tonkatsu: 14,
            gukbap: undefined
          }
        };
      }

      // Daily auto-zero: Retrieve simulated tallies for today or initialize all to 0표
      const todayKst = this.state.getTodayKstDateString();
      const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
      let stored = localStorage.getItem(dateKey);
      let tallies = {};
      if (stored) {
        try {
          tallies = JSON.parse(stored);
        } catch {
          tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
        }
      } else {
        tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
        localStorage.setItem(dateKey, JSON.stringify(tallies));
      }

      return {
        status: 'success',
        server_time_kst: serverTimeKst,
        tallies
      };
    }

    async submitMockVote(menuId, requestId) {
      if (this.faultInjection === 'timeout') {
        await new Promise(res => setTimeout(res, 5200));
        throw new Error('Network request timed out (>= 5000ms)');
      }

      if (this.faultInjection === 'lock_fail') {
        await new Promise(res => setTimeout(res, 500));
        throw new Error('Server lock acquisition failed (LockService exhaustion > 10s)');
      }

      await new Promise(res => setTimeout(res, 280));

      const now = Date.now();
      if (this.simulatedIdempotencyCache.has(requestId)) {
        const cachedTime = this.simulatedIdempotencyCache.get(requestId);
        if (now - cachedTime < 10000) {
          console.warn(`[IDEMPOTENCY] Dropped duplicate request ID: ${requestId}`);
          const currentData = await this.fetchMockTelemetry();
          return {
            status: 'success',
            idempotent_duplicate: true,
            server_time_kst: currentData.server_time_kst,
            tallies: currentData.tallies
          };
        }
      }
      this.simulatedIdempotencyCache.set(requestId, now);

      let currentData = await this.fetchMockTelemetry();
      let tallies = { ...currentData.tallies };
      tallies[menuId] = (tallies[menuId] || 0) + 1;
      // [FIX] 날짜 키에 저장 (fetchMockTelemetry가 읽는 키와 동일하게)
      const todayKst = this.state.getTodayKstDateString();
      const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
      localStorage.setItem(dateKey, JSON.stringify(tallies));

      for (const [id, time] of this.simulatedIdempotencyCache.entries()) {
        if (now - time > 15000) {
          this.simulatedIdempotencyCache.delete(id);
        }
      }

      return {
        status: 'success',
        server_time_kst: currentData.server_time_kst,
        tallies
      };
    }
  }

  // =========================================================================
  // 4. LunchVoteApp Controller
  // =========================================================================
  class LunchVoteApp {
    constructor() {
      this.state = new VotingState();
      this.api = new ApiClient(this.state);
      this.debounceTimer = null;
      this.toastTimer = null;

      this.elements = {
        menuGrid: document.getElementById('menuGrid'),
        btnVote: document.getElementById('btnVote'),
        voteBtnText: document.getElementById('voteBtnText'),
        voteBtnSpinner: document.getElementById('voteBtnSpinner'),
        voteNoticeText: document.getElementById('voteNoticeText'),
        totalVotesBadge: document.getElementById('totalVotesBadge'),
        serverTimeDisplay: document.getElementById('serverTimeDisplay'),
        statusDot: document.getElementById('statusDot'),
        statusText: document.getElementById('statusText'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage'),
        toastIcon: document.getElementById('toastIcon'),
        themeToggleBtn: document.getElementById('themeToggleBtn'),
        settingsModal: document.getElementById('settingsModal'),
        btnOpenSettings: document.getElementById('btnOpenSettings'),
        btnCloseSettings: document.getElementById('btnCloseSettings'),
        btnSaveSettings: document.getElementById('btnSaveSettings'),
        btnResetVote: document.getElementById('btnResetVote'),
        gasUrlInput: document.getElementById('gasUrlInput'),
        modeSelect: document.getElementById('modeSelect'),
        faultSelect: document.getElementById('faultSelect'),
      };

      this.init();
    }

    init() {
      this.initTheme();
      this.renderMenuCards();
      this.setupEventListeners();

      this.state.subscribe((snapshot) => this.handleStateUpdate(snapshot));
      this.reconcileServerState();

      setInterval(() => {
        this.reconcileServerState(false);
      }, CONFIG.POLL_INTERVAL_MS);

      this.state.checkDailyVoteStatus();
    }

    initTheme() {
      const savedTheme = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME);
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
      this.applyTheme(initialTheme);
    }

    applyTheme(theme) {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        this.elements.themeToggleBtn.innerHTML = '☀️ <span class="visually-hidden">라이트 모드로 전환</span>';
        this.elements.themeToggleBtn.setAttribute('title', '라이트 모드로 전환');
      } else {
        document.documentElement.removeAttribute('data-theme');
        this.elements.themeToggleBtn.innerHTML = '🌙 <span class="visually-hidden">다크 모드로 전환</span>';
        this.elements.themeToggleBtn.setAttribute('title', '다크 모드로 전환');
      }
      localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, theme);
    }

    toggleTheme() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      this.applyTheme(isDark ? 'light' : 'dark');
    }

    renderMenuCards() {
      this.elements.menuGrid.innerHTML = '';

      CONFIG.MENU_ITEMS.forEach(item => {
        const card = document.createElement('div');
        card.className = 'menu-card';
        card.id = `card-${item.id}`;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', 'false');
        card.setAttribute('tabindex', '0');
        card.setAttribute('data-menu-id', item.id);
        card.setAttribute('aria-label', `${item.title} (${item.subtitle}): ${item.desc}`);

        card.innerHTML = `
          <div class="badge-top-rank" id="badge-${item.id}" style="display: none;">
            🏆 <span>1위</span>
          </div>
          <div class="card-top">
            <div class="food-image-wrapper">
              <img src="${item.image}" alt="${item.title}" class="food-image" loading="lazy">
            </div>
            <div class="card-info">
              <div class="card-title-row">
                <h3 class="menu-title" title="${item.title}">${item.title}</h3>
                <div class="radio-indicator" aria-hidden="true"></div>
              </div>
              <p class="menu-desc" title="${item.desc}">${item.desc}</p>
            </div>
          </div>
          <div class="card-bottom">
            <div class="telemetry-row">
              <span class="tally-count" id="count-${item.id}">0표</span>
              <span class="tally-percentage" id="pct-${item.id}">0%</span>
            </div>
            <div class="progress-bar-track" aria-hidden="true">
              <div class="progress-bar-fill" id="bar-${item.id}" style="width: 0%;"></div>
            </div>
          </div>
        `;

        card.addEventListener('click', () => this.handleCardSelectWithDebounce(item.id));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.handleCardSelectWithDebounce(item.id);
          }
        });

        this.elements.menuGrid.appendChild(card);
      });
    }

    handleCardSelectWithDebounce(menuId) {
      if (this.state.hasVotedToday || this.state.isSubmitting) return;

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.state.selectMenu(menuId);
      }, CONFIG.INPUT_DEBOUNCE_MS);
    }

    setupEventListeners() {
      this.elements.btnVote.addEventListener('click', () => this.handleVoteSubmission());
      this.elements.themeToggleBtn.addEventListener('click', () => this.toggleTheme());

      this.elements.btnOpenSettings.addEventListener('click', () => this.openSettingsModal());
      this.elements.btnCloseSettings.addEventListener('click', () => this.closeSettingsModal());
      this.elements.btnSaveSettings.addEventListener('click', () => this.saveSettings());
            // [FIX] 내 투표 기록 초기화: GAS에서 해당 메뉴 -1 차감 후 로컬 토큰 삭제
      this.elements.btnResetVote.addEventListener('click', async () => {
        const votedMenuId = this.state.votedMenuId;
        this.closeSettingsModal();
        this.setStatusSyncing(true, '투표 기록 초기화 중...');
        try {
          const result = await this.api.cancelVote(votedMenuId);
          this.state.resetDailyVoteForTesting();
          if (result && result.tallies) {
            this.state.reconcileServerTallies(result.tallies);
          } else {
            await this.reconcileServerState(false);
          }
          this.showToast('✅ 투표 기록이 초기화되었습니다. 다시 투표할 수 있습니다.', 'info');
        } catch (err) {
          console.error('cancelVote error:', err);
          this.state.resetDailyVoteForTesting();
          this.showToast('✅ 로컬 투표 기록이 초기화되었습니다. (서버 차감 실패)', 'warning');
        } finally {
          this.setStatusSyncing(false, '동기화 완료');
        }
      });
      const btnResetTallies = document.getElementById('btnResetTallies');
      if (btnResetTallies) {
        btnResetTallies.addEventListener('click', async () => {
          const zeroTallies = await this.api.resetTallies();
          this.state.reconcileServerTallies(zeroTallies);
          this.showToast('모든 메뉴의 득표수가 0표로 초기화되었습니다.', 'info');
          this.closeSettingsModal();
        });
      }

      this.elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === this.elements.settingsModal) this.closeSettingsModal();
      });


      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeSettingsModal();
        }
      });

    }

    async handleVoteSubmission() {
      const { selectedMenuId, hasVotedToday, isSubmitting } = this.state.getSnapshot();

      if (!selectedMenuId) {
        this.showToast('투표할 메뉴를 선택해 주세요.', 'warning');
        return;
      }

      if (hasVotedToday) {
        this.showToast('오늘은 이미 투표하셨습니다. (1일 1회 제한)', 'warning');
        return;
      }

      if (isSubmitting) return;

      const targetMenuId = selectedMenuId;
      const requestId = this.state.optimisticIncrement(targetMenuId);

      this.setStatusSyncing(true, '서버에 투표를 반영하는 중...');

      try {
        const response = await this.api.submitVote(targetMenuId, requestId);

        this.state.finalizeSubmission(targetMenuId, requestId);
        this.setStatusSyncing(false, '투표가 성공적으로 완료되었습니다.');
        this.showToast('🎉 점심 투표가 성공적으로 반영되었습니다!', 'success');

        if (response.server_time_kst) {
          this.state.updateServerTimeDrift(response.server_time_kst);
        }
        if (response.tallies) {
          this.state.reconcileServerTallies(response.tallies);
        }
      } catch (error) {
        console.error('Vote submission failed:', error);
        
        // SRS-FR-005 Transactional Rollback
        this.state.rollbackIncrement(targetMenuId);
        this.setStatusSyncing(false, '서버 연결 지연');
        this.showToast(CONFIG.FALLBACK_TOAST_MESSAGE, 'error');

        setTimeout(() => {
          this.reconcileServerState(false);
        }, 3000);
      }
    }

    async reconcileServerState(showIndicator = true) {
      if (showIndicator) {
        this.setStatusSyncing(true, '서버 데이터 동기화 중...');
      }

      try {
        const data = await this.api.fetchTelemetry();
        if (data && data.status === 'success') {
          if (data.server_time_kst) {
            this.state.updateServerTimeDrift(data.server_time_kst);
          }
          if (data.tallies) {
            this.state.reconcileServerTallies(data.tallies);
          }
          this.setStatusSyncing(false, '실시간 동기화 완료');
        }
      } catch (err) {
        this.setStatusSyncing(false, '오프라인 / 로컬 캐시 사용 중');
      }
    }

    handleStateUpdate(snapshot) {
      const {
        selectedMenuId,
        tallies,
        totalVotes,
        topItem,
        isSubmitting,
        hasVotedToday,
        votedMenuId,
        serverTimeKstStr
      } = snapshot;

      if (serverTimeKstStr) {
        this.elements.serverTimeDisplay.textContent = serverTimeKstStr;
      } else {
        const localKst = new Date().toLocaleTimeString('ko-KR', {
          timeZone: 'Asia/Seoul',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + ' KST';
        this.elements.serverTimeDisplay.textContent = localKst;
      }

      this.elements.totalVotesBadge.textContent = `${totalVotes}표`;

      CONFIG.MENU_ITEMS.forEach(item => {
        const card = document.getElementById(`card-${item.id}`);
        const countEl = document.getElementById(`count-${item.id}`);
        const pctEl = document.getElementById(`pct-${item.id}`);
        const barEl = document.getElementById(`bar-${item.id}`);
        const badgeEl = document.getElementById(`badge-${item.id}`);

        const count = tallies[item.id] || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

        countEl.textContent = `${count}표`;
        pctEl.textContent = `${pct}%`;
        barEl.style.width = `${pct}%`;

        // Dynamic top-rank badge (FR-2.2: 1st Place / Co-First Place)
        const isTopItem = Array.isArray(topItem) && topItem.includes(item.id);
        const isSharedFirst = Array.isArray(topItem) && topItem.length > 1;

        if (isTopItem) {
          badgeEl.style.display = 'flex';
          badgeEl.innerHTML = isSharedFirst
            ? '🏆 <span>공동 1위</span>'
            : '🏆 <span>1위</span>';
          barEl.classList.add('leader');
        } else {
          badgeEl.style.display = 'none';
          barEl.classList.remove('leader');
        }

        const isSelected = selectedMenuId === item.id;
        if (isSelected) {
          card.classList.add('selected');
          card.setAttribute('aria-checked', 'true');
        } else {
          card.classList.remove('selected');
          card.setAttribute('aria-checked', 'false');
        }

        if (hasVotedToday) {
          card.classList.add('disabled');
          if (votedMenuId === item.id) {
            card.classList.add('selected');
          }
        } else {
          card.classList.remove('disabled');
        }
      });

      if (hasVotedToday) {
        this.elements.btnVote.disabled = true;
        this.elements.voteBtnSpinner.style.display = 'none';
        this.elements.voteBtnText.textContent = '오늘 투표 완료';
        this.elements.voteNoticeText.innerHTML = `✅ <strong>오늘 투표가 이미 완료되었습니다.</strong> 내일 자정(00:00 KST)에 초기화됩니다.`;
      } else if (isSubmitting) {
        this.elements.btnVote.disabled = true;
        this.elements.voteBtnSpinner.style.display = 'inline-block';
        this.elements.voteBtnText.textContent = '투표 처리 중...';
        this.elements.voteNoticeText.textContent = '서버에 원자적 동기화를 진행하고 있습니다.';
      } else {
        this.elements.btnVote.disabled = !selectedMenuId;
        this.elements.voteBtnSpinner.style.display = 'none';
        this.elements.voteBtnText.textContent = '투표하기';
        this.elements.voteNoticeText.textContent = selectedMenuId 
          ? '선택한 메뉴에 투표합니다. (1일 1회 가능)'
          : '위 메뉴 카드 중 점심으로 드시고 싶은 메뉴를 1개 선택해 주세요.';
      }
    }

    setStatusSyncing(isSyncing, text) {
      if (isSyncing) {
        this.elements.statusDot.className = 'status-dot syncing';
      } else {
        this.elements.statusDot.className = 'status-dot';
      }
      this.elements.statusText.textContent = text;
    }

    showToast(message, type = 'info') {
      const iconMap = {
        success: '✅',
        error: '⚠️',
        warning: '🔔',
        info: 'ℹ️'
      };

      this.elements.toastIcon.textContent = iconMap[type] || 'ℹ️';
      this.elements.toastMessage.textContent = message;
      this.elements.toast.className = `toast show ${type}`;

      if (this.toastTimer) {
        clearTimeout(this.toastTimer);
      }

      this.toastTimer = setTimeout(() => {
        this.elements.toast.classList.remove('show');
      }, 4500);
    }

    openSettingsModal() {
      this.elements.gasUrlInput.value = this.api.gasUrl;
      this.elements.modeSelect.value = this.api.isMockMode ? 'mock' : 'gas';
      this.elements.faultSelect.value = this.api.faultInjection;
      this.elements.settingsModal.classList.add('open');
      this.elements.gasUrlInput.focus();
    }

    closeSettingsModal() {
      this.elements.settingsModal.classList.remove('open');
    }

    saveSettings() {
      const newUrl = this.elements.gasUrlInput.value.trim();
      const isMock = this.elements.modeSelect.value === 'mock';
      const fault = this.elements.faultSelect.value;

      this.api.setGasUrl(newUrl);
      this.api.setMockMode(isMock);
      this.api.setFaultInjection(fault);

      this.showToast('설정이 저장되었습니다. 서버 상태를 다시 확인합니다.', 'success');
      this.closeSettingsModal();
      this.reconcileServerState(true);
    }
  }


  // Expose to window for testing & debugging
  window.CONFIG = CONFIG;
  window.VotingState = VotingState;
  window.ApiClient = ApiClient;

  document.addEventListener('DOMContentLoaded', () => {
    window.lunchApp = new LunchVoteApp();
  });
})();
