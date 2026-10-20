/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * Main Application Controller & UI Binder
 * Standard Compliance: IEEE Std 830-1998 / ISO/IEC/IEEE 29148 / WCAG 2.1 AA
 */

import { CONFIG } from './config.js';
import { VotingState } from './state.js';
import { ApiClient } from './api.js';

export class LunchVoteApp {
  constructor() {
    this.state = new VotingState();
    this.api = new ApiClient(this.state);
    this.debounceTimer = null;
    this.toastTimer = null;
    
    // Bind DOM elements
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
    
    // Subscribe to state changes for reactive UI updates
    this.state.subscribe((snapshot) => this.handleStateUpdate(snapshot));

    // Initial server reconciliation
    this.reconcileServerState();

    // Start background reconciliation loop (SRS-FR-002)
    setInterval(() => {
      this.reconcileServerState(false);
    }, CONFIG.POLL_INTERVAL_MS);

    // Initial check of vote status
    this.state.checkDailyVoteStatus();
  }

  // =========================================================================
  // Theme Management (Light / Dark Mode, SRS Section 3 & 5)
  // =========================================================================

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

  // =========================================================================
  // Menu Card Rendering (US-01, FR-1.1, SRS-FR-001)
  // =========================================================================

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

      // Event listener with 300ms debounce (SRS-FR-001 & FR-1.2)
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

  /**
   * SRS-FR-001 & FR-1.2: Enforce 300ms input debounce on client interaction
   * @param {string} menuId 
   */
  handleCardSelectWithDebounce(menuId) {
    if (this.state.hasVotedToday || this.state.isSubmitting) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.state.selectMenu(menuId);
    }, CONFIG.INPUT_DEBOUNCE_MS);
  }

  // =========================================================================
  // Event Listeners & UI Binding
  // =========================================================================

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
          // GAS 응답 없을 시 폴링으로 최신 상태 동기화
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

  }


  // =========================================================================
  // Atomic Vote Submission & Transactional Rollback (SRS-FR-002 & SRS-FR-005)
  // =========================================================================

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

    // 1. Optimistic UI update (SRS-FR-002 & NFR-1):
    // Local tally +1 instantly with 0ms perceived latency
    const targetMenuId = selectedMenuId;
    const requestId = this.state.optimisticIncrement(targetMenuId);

    this.setStatusSyncing(true, '서버에 투표를 반영하는 중...');

    try {
      // 2. Submit vote with 5000ms max timeout (SRS-FR-005 & NFR-3)
      const response = await this.api.submitVote(targetMenuId, requestId);

      // 3. Success reconciliation
      this.state.finalizeSubmission(targetMenuId, requestId);
      this.setStatusSyncing(false, '투표가 성공적으로 완료되었습니다.');
      this.showToast('🎉 점심 투표가 성공적으로 반영되었습니다!', 'success');

      // Update server time & reconciles telemetry from response
      if (response.server_time_kst) {
        this.state.updateServerTimeDrift(response.server_time_kst);
      }
      if (response.tallies) {
        this.state.reconcileServerTallies(response.tallies);
      }
    } catch (error) {
      console.error('Vote submission failed:', error);
      
      // 4. Transactional Rollback & Graceful Fallback (SRS-FR-005 & TC-ERR-001)
      // (1) Local tally rolls back -1
      this.state.rollbackIncrement(targetMenuId);

      // (2) UI controls re-enable (dismisses spinner, re-enables buttons)
      this.setStatusSyncing(false, '서버 연결 지연');

      // (3) Toast displays exact Korean message from SRS-FR-005:
      // '현재 대기자가 많습니다. 3초 후 다시 시도해 주세요.'
      this.showToast(CONFIG.FALLBACK_TOAST_MESSAGE, 'error');

      // (4) Background GET poll re-synchronizes telemetry
      setTimeout(() => {
        this.reconcileServerState(false);
      }, 3000);
    }
  }

  /**
   * Background GET poll to reconcile server telemetry state (SRS-FR-002)
   */
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
      console.warn('Background telemetry sync skipped:', err);
      this.setStatusSyncing(false, '오프라인 / 로컬 캐시 사용 중');
    }
  }

  // =========================================================================
  // State Reactive UI Updater
  // =========================================================================

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

    // 1. Update Server KST Time display (FR-3.3)
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

    // 2. Update Total Votes badge
    this.elements.totalVotesBadge.textContent = `${totalVotes}표`;

    // 3. Update Menu Cards
    CONFIG.MENU_ITEMS.forEach(item => {
      const card = document.getElementById(`card-${item.id}`);
      const countEl = document.getElementById(`count-${item.id}`);
      const pctEl = document.getElementById(`pct-${item.id}`);
      const barEl = document.getElementById(`bar-${item.id}`);
      const badgeEl = document.getElementById(`badge-${item.id}`);

      const count = tallies[item.id] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

      // Defensive Telemetry formatting (SRS-FR-003): integer rendering as "X표"
      countEl.textContent = `${count}표`;
      pctEl.textContent = `${pct}%`;
      barEl.style.width = `${pct}%`;

      // Dynamic top-rank badge (FR-2.2: 1st Place / Co-First Place)
      // topItem은 이제 배열: 단독이면 ['jeyuk'], 공동이면 ['jeyuk','jajang'] 등
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

      // Selection State Styling (SRS-FR-001)
      const isSelected = selectedMenuId === item.id;
      if (isSelected) {
        card.classList.add('selected');
        card.setAttribute('aria-checked', 'true');
      } else {
        card.classList.remove('selected');
        card.setAttribute('aria-checked', 'false');
      }

      // Voted status styling
      if (hasVotedToday) {
        card.classList.add('disabled');
        if (votedMenuId === item.id) {
          card.classList.add('selected');
        }
      } else {
        card.classList.remove('disabled');
      }
    });

    // 4. Update Primary Button & Submission Spinner (FR-1.3)
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

  // =========================================================================
  // Toast & Status Utilities
  // =========================================================================

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

  // =========================================================================
  // Settings & Simulation Modal
  // =========================================================================

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

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.lunchApp = new LunchVoteApp();
});
