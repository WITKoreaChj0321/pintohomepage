/*!
 * PINTO Footprint v1.0
 * 외부: 일/총 방문자 표시 | 내부: UTM·채널·전환·스크롤·멀티터치 분석
 * 디버그: ?fp_debug | 콘솔: window.PintoFP.dashboard()
 */
(function () {
  'use strict';

  const C = {
    ns: 'pinto-daegu-2026',
    vKey: 'pinto_fp_v',
    sKey: 'pinto_fp_s',
    cntKey: 'pinto_cnt',
    hitKey: 'pinto_fp_hit',
    webhookUrl: null,
    debug: false
  };

  const ls = {
    get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const ss = {
    get: k => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Date.now();
  const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // ── UTM 파싱
  function parseUTM() {
    const p = new URLSearchParams(location.search);
    return {
      source: p.get('utm_source') || '',
      medium: p.get('utm_medium') || '',
      campaign: p.get('utm_campaign') || '',
      term: p.get('utm_term') || '',
      content: p.get('utm_content') || ''
    };
  }

  // ── 유입 채널 감지
  function detectChannel(utm) {
    if (utm.source) {
      const s = utm.source.toLowerCase();
      if (s.includes('naver')) return 'naver';
      if (s.includes('google')) return 'google';
      if (s.includes('instagram') || s.includes('insta')) return 'instagram';
      if (s.includes('kakao')) return 'kakao';
      if (s.includes('youtube')) return 'youtube';
      return 'utm_' + s;
    }
    const ref = document.referrer.toLowerCase();
    if (!ref) return 'direct';
    if (ref.includes('naver.com') || ref.includes('search.naver')) return 'naver';
    if (ref.includes('google.com')) return 'google';
    if (ref.includes('instagram.com')) return 'instagram';
    if (ref.includes('kakao.com') || ref.includes('kakaotalk')) return 'kakao';
    if (ref.includes('youtube.com')) return 'youtube';
    return 'referral';
  }

  // ── 기기 정보
  function getDevice() {
    const ua = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
    return {
      type: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
      os: /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Win/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'other',
      browser: /Chrome/.test(ua) && !/Edge/.test(ua) ? 'Chrome' : /Safari/.test(ua) && !/Chrome/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : /Edge/.test(ua) ? 'Edge' : 'other',
      screen: screen.width + 'x' + screen.height,
      lang: navigator.language || ''
    };
  }

  // ── 브라우저 핑거프린트 (djb2 해시)
  function fingerprint() {
    const raw = [navigator.userAgent, navigator.language, screen.width, screen.height,
      screen.colorDepth, Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency || 0].join('|');
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  // ── 방문자 (localStorage 영속)
  function initVisitor() {
    let v = ls.get(C.vKey);
    if (!v) {
      v = { id: uid(), fp: fingerprint(), firstSeen: now(), visits: 0, lastSeen: 0, touchpoints: [] };
    }
    v.visits += 1;
    v.lastSeen = now();
    ls.set(C.vKey, v);
    return v;
  }

  // ── 세션 (sessionStorage)
  function initSession(visitor) {
    let s = ss.get(C.sKey);
    if (s) return s;
    const utm = parseUTM();
    const channel = detectChannel(utm);
    s = {
      id: uid(),
      visitorId: visitor.id,
      start: now(),
      landing: location.pathname + location.search,
      referrer: document.referrer,
      channel,
      utm,
      device: getDevice(),
      isReturn: visitor.visits > 1,
      scrollMax: 0,
      events: [],
      dur: 0
    };
    ss.set(C.sKey, s);
    return s;
  }

  function getSess() { return ss.get(C.sKey); }

  function saveSess(s) { ss.set(C.sKey, s); }

  // ── GA4 이벤트 전송
  function ga4(name, params) {
    if (typeof gtag === 'function') gtag('event', name, params || {});
  }

  // ── 이벤트 추적
  function track(name, data) {
    const s = getSess();
    if (!s) return;
    const ev = { t: Date.now(), name, ...data };
    s.events.push(ev);
    saveSess(s);
    if (C.debug) console.log('[PintoFP] track:', name, data);
    if (C.webhookUrl) beacon({ type: 'event', visitorId: s.visitorId, name, data });
    // GA4 연동
    ga4(name, data);
  }

  // ── 스크롤 깊이 (25/50/75/90/100%)
  function initScroll() {
    const milestones = [25, 50, 75, 90, 100];
    let fired = new Set();
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrolled = window.scrollY + window.innerHeight;
        const total = document.documentElement.scrollHeight;
        const pct = Math.round((scrolled / total) * 100);
        const s = getSess();
        if (s && pct > s.scrollMax) { s.scrollMax = pct; saveSess(s); }
        milestones.forEach(m => {
          if (!fired.has(m) && pct >= m) { fired.add(m); track('scroll', { depth: m }); }
        });
        ticking = false;
      });
    }, { passive: true });
  }

  // ── 전환 이벤트
  function initConversions() {
    const rules = [
      { sel: 'a[href*="booking.naver.com"]', name: 'booking_naver' },
      { sel: 'a[href^="tel:"]', name: 'call' },
      { sel: 'a[href*="naver.me"]', name: 'navertalk' },
      { sel: 'a[href*="instagram.com"]', name: 'instagram' },
      { sel: 'a[href*="map.naver.com"]', name: 'map' },
      { sel: '.floating-btn', name: 'floating_btn' },
      { sel: '.nav-book', name: 'nav_book' }
    ];
    rules.forEach(({ sel, name }) => {
      document.querySelectorAll(sel).forEach(el => {
        el.addEventListener('click', () => {
          const label = el.textContent.trim().slice(0, 30);
          track('conversion', { action: name, label });
          // GA4 표준 이벤트로도 전송
          if (name === 'booking_naver' || name === 'nav_book') {
            ga4('generate_lead', { method: 'naver_booking', event_label: label });
          } else if (name === 'call') {
            ga4('generate_lead', { method: 'phone_call', event_label: label });
          } else if (name === 'navertalk') {
            ga4('generate_lead', { method: 'naver_talk', event_label: label });
          }
        });
      });
    });
  }

  // ── 멀티터치 기록
  function recordTouch(visitor, sess) {
    const touch = {
      t: now(),
      ch: sess.channel,
      src: sess.utm.source,
      camp: sess.utm.campaign,
      page: sess.landing
    };
    visitor.touchpoints = [...(visitor.touchpoints || []), touch].slice(-20);
    ls.set(C.vKey, visitor);
  }

  // ── 방문자 카운터 (counterapi.dev)
  async function fetchCounter() {
    const dateKey = today();
    const alreadyHit = ss.get(C.hitKey);
    const base = 'https://api.counterapi.dev/v1';
    const ns = C.ns;

    try {
      let daily, total;

      if (!alreadyHit) {
        const [dRes, tRes] = await Promise.all([
          fetch(`${base}/${ns}/d${dateKey}/up`),
          fetch(`${base}/${ns}/total/up`)
        ]);
        const dData = await dRes.json();
        const tData = await tRes.json();
        daily = dData.count;
        total = tData.count;
        ss.set(C.hitKey, true);
      } else {
        const [dRes, tRes] = await Promise.all([
          fetch(`${base}/${ns}/d${dateKey}`),
          fetch(`${base}/${ns}/total`)
        ]);
        const dData = await dRes.json();
        const tData = await tRes.json();
        daily = dData.count;
        total = tData.count;
      }

      ls.set(C.cntKey, { daily, total, date: dateKey, ts: now() });
      renderCounter(daily, total);
    } catch {
      const cache = ls.get(C.cntKey);
      if (cache) renderCounter(cache.daily, cache.total);
    }
  }

  function renderCounter(daily, total) {
    document.querySelectorAll('[data-fp="daily"]').forEach(el => {
      el.textContent = Number(daily || 0).toLocaleString('ko');
    });
    document.querySelectorAll('[data-fp="total"]').forEach(el => {
      el.textContent = Number(total || 0).toLocaleString('ko');
    });
  }

  // ── Webhook/CRM (비차단 전송)
  function beacon(data) {
    if (!C.webhookUrl) return;
    const payload = JSON.stringify(data);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(C.webhookUrl, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(C.webhookUrl, { method: 'POST', body: payload, keepalive: true }).catch(() => {});
    }
  }

  function initBeacon(sess) {
    const send = () => {
      const s = getSess();
      if (!s) return;
      s.dur = Math.round((now() - s.start) / 1000);
      saveSess(s);
      const v = ls.get(C.vKey);
      beacon({ type: 'session_end', visitor: v, session: s });
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
    window.addEventListener('pagehide', send);
  }

  // ── 콘솔 대시보드
  function dashboard() {
    const v = ls.get(C.vKey);
    const s = getSess();
    const cnt = ls.get(C.cntKey);
    console.group('%c[PintoFP] 대시보드', 'color:#a07840;font-weight:bold');
    console.log('📊 카운터 | 오늘:', cnt?.daily, '/ 누적:', cnt?.total);
    console.log('👤 방문자 | ID:', v?.id, '방문횟수:', v?.visits, '첫방문:', v?.firstSeen ? new Date(v.firstSeen).toLocaleString('ko') : '-');
    console.log('🔗 세션   | 채널:', s?.channel, 'UTM:', JSON.stringify(s?.utm));
    console.log('📱 기기   |', JSON.stringify(s?.device));
    console.log('📜 이벤트 |', s?.events?.length, '개', s?.events);
    console.log('🎯 멀티터치|', v?.touchpoints?.length, '개', v?.touchpoints);
    console.log('📤 JSON   | window.PintoFP.export()로 내보내기');
    console.groupEnd();
  }

  // ── 초기화
  function init() {
    C.debug = new URLSearchParams(location.search).has('fp_debug');
    const visitor = initVisitor();
    const sess = initSession(visitor);
    recordTouch(visitor, sess);
    initScroll();
    initConversions();
    initBeacon(sess);
    fetchCounter();

    window.PintoFP = {
      dashboard,
      track,
      session: getSess,
      visitor: () => ls.get(C.vKey),
      export: () => JSON.stringify({ visitor: ls.get(C.vKey), session: getSess(), counter: ls.get(C.cntKey) }, null, 2)
    };

    if (C.debug) {
      setTimeout(dashboard, 800);
      console.log('[PintoFP] 디버그 모드 ON. URL에서 ?fp_debug 제거 시 해제됩니다.');
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
