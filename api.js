/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * API Proxy & Google Apps Script (GAS) Communication Layer
 * Supports Production GAS Endpoint + Interactive Fault-Injection Simulator
 * Standard Compliance: IEEE Std 830-1998 / ISO/IEC/IEEE 29148 / ISO/IEC/IEEE 29119
 */

import { CONFIG } from './config.js';

export class ApiClient {
  constructor(state) {
    this.state = state;
    this.gasUrl = localStorage.getItem(CONFIG.STORAGE_KEYS.GAS_URL) || CONFIG.DEFAULT_GAS_URL || '';
    const storedMock = localStorage.getItem(CONFIG.STORAGE_KEYS.MOCK_MODE);
    this.isMockMode = storedMock === null ? false : storedMock === 'true';
    this.faultInjection = localStorage.getItem(CONFIG.STORAGE_KEYS.FAUL_INJECTION) || 'none';
    
    // In-memory idempotency cache for simulator (10-second window, FR-3.2)
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
    // 'none' | 'timeout' | 'lock_fail' | 'corrupt_data'
    this.faultInjection = mode;
    localStorage.setItem(CONFIG.STORAGE_KEYS.FAUL_INJECTION, mode);
  }

  /**
   * Resets all tallies on the server and local storage to 0
   */
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

  /**
   * Fetches latest telemetry from GAS Web App or Mock Simulator
   * @returns {Promise<Object>}
   */
  async fetchTelemetry() {
    if (!this.gasUrl || this.isMockMode) {
      return this.fetchMockTelemetry();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.gasUrl}?action=getTallies&t=${Date.now()}`, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-cache',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('GAS fetch telemetry failed:', err);
      throw err;
    }
  }

  /**
   * Submits a vote to GAS Web App or Mock Simulator (POST JSON via text/plain)
   * @param {string} menuId 
   * @param {string} requestId UUIDv4
   * @returns {Promise<Object>}
   */
  async submitVote(menuId, requestId) {
    if (!this.gasUrl || this.isMockMode) {
      return this.submitMockVote(menuId, requestId);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    try {
      const payload = {
        menuId: menuId,
        requestId: requestId
      };

      const response = await fetch(this.gasUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Vote Submission Failed`);
      }

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

  // =========================================================================
  // Built-in Mock Simulator
  // =========================================================================

  async fetchMockTelemetry() {
    await new Promise(res => setTimeout(res, 150));

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
      await new Promise(res => setTimeout(res, 600));
      throw new Error('Server lock acquisition failed');
    }

    await new Promise(res => setTimeout(res, 350));

    const now = Date.now();
    if (this.simulatedIdempotencyCache.has(requestId)) {
      const cachedTime = this.simulatedIdempotencyCache.get(requestId);
      if (now - cachedTime < 10000) {
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
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_TALLIES, JSON.stringify(tallies));

    return {
      status: 'success',
      server_time_kst: currentData.server_time_kst,
      tallies
    };
  }
}