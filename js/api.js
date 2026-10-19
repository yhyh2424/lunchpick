/**
 * Lunch Menu Voting Web Service (v4.1.0)
 * API Proxy & Google Apps Script (GAS) Communication Layer
 * FIX: cancelVote 기능 추가, 중복 코드 제거
 */

import { CONFIG } from './config.js';

export class ApiClient {
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

  // ── resetTallies (전체 0 초기화) ──────────────────────────────────────────

  async resetTallies() {
    const todayKst = this.state.getTodayKstDateString();
    const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
    const zeroTallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
    localStorage.setItem(dateKey, JSON.stringify(zeroTallies));
    localStorage.removeItem(CONFIG.STORAGE_KEYS.LOCAL_TALLIES);

    if (this.gasUrl && !this.isMockMode) {
      try {
        await fetch(`${this.gasUrl}?action=resetTallies&t=${Date.now()}`, { method: 'GET' });
      } catch (ex) {
        console.warn('GAS reset request error:', ex);
      }
    }
    return zeroTallies;
  }

  // ── cancelVote (내 투표 기록 초기화: 해당 메뉴 -1) ───────────────────────

  async cancelVote(menuId) {
    if (!menuId) return;

    if (!this.gasUrl || this.isMockMode) {
      // 시뮬레이터 모드: localStorage에서 -1
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

    // GAS 실서버 모드: cancelVote POST
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

  // ── fetchTelemetry ────────────────────────────────────────────────────────

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
      console.warn('GAS fetchTelemetry failed:', err);
      throw err;
    }
  }

  // ── submitVote ────────────────────────────────────────────────────────────

  async submitVote(menuId, requestId) {
    if (!this.gasUrl || this.isMockMode) {
      return this.submitMockVote(menuId, requestId);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    try {
      const payload = { action: 'vote', menuId, requestId, clientTimestamp: Date.now() };
      // 커스텀 헤더 제거 → CORS preflight 방지
      const response = await fetch(this.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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

  // ── Mock Simulator ────────────────────────────────────────────────────────

  async fetchMockTelemetry() {
    await new Promise(res => setTimeout(res, 150));

    const now = new Date();
    const kstEpoch = now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 60 * 60 * 1000);
    const serverTimeKst = new Date(kstEpoch).toISOString();

    if (this.faultInjection === 'corrupt_data') {
      return {
        status: 'success',
        server_time_kst: serverTimeKst,
        tallies: { jeyuk: null, jajang: 'INVALID_STR', tonkatsu: 14, gukbap: undefined }
      };
    }

    const todayKst = this.state.getTodayKstDateString();
    const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
    let stored = localStorage.getItem(dateKey);
    let tallies = {};
    if (stored) {
      try { tallies = JSON.parse(stored); }
      catch { tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 }; }
    } else {
      tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
      localStorage.setItem(dateKey, JSON.stringify(tallies));
    }

    return { status: 'success', server_time_kst: serverTimeKst, tallies };
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

    await new Promise(res => setTimeout(res, 350));

    const now = Date.now();
    if (this.simulatedIdempotencyCache.has(requestId)) {
      const cachedTime = this.simulatedIdempotencyCache.get(requestId);
      if (now - cachedTime < 10000) {
        console.warn(`[IDEMPOTENCY] Dropped duplicate: ${requestId}`);
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

    // [FIX] 날짜 키에 저장 (fetchMockTelemetry와 동일한 키)
    const todayKst = this.state.getTodayKstDateString();
    const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
    localStorage.setItem(dateKey, JSON.stringify(tallies));

    for (const [id, time] of this.simulatedIdempotencyCache.entries()) {
      if (now - time > 15000) this.simulatedIdempotencyCache.delete(id);
    }

    return { status: 'success', server_time_kst: currentData.server_time_kst, tallies };
  }
}