/**
 * yuMeet Embed Kit (ch10 §10.6 L0)
 * 零依赖 Web Components — 把会议信息装进任何网站,两行 HTML 即可。
 *
 *   <script type="module" src="https://yumeet.ywang.science/embed.js" async></script>
 *   <yumeet-event-list org="icranet" limit="5"></yumeet-event-list>
 *
 * 不设 cookie、不做跟踪、不带凭证请求;样式经 Shadow DOM 隔离,默认继承宿主字体与配色。
 */
(function () {
  'use strict';

  /**
   * 从自身 <script> 的 origin 推断 API base,支持跨源加载。
   * 注意:以 type="module" 加载时 document.currentScript 为 null,
   * 必须回查 script[src] 才能拿到自身地址。
   */
  function selfSrc() {
    if (document.currentScript && document.currentScript.src) {
      return document.currentScript.src;
    }
    var scripts = document.querySelectorAll('script[src]');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i].getAttribute('src') || '';
      if (/(^|\/)embed\.js(\?|#|$)/.test(s)) return scripts[i].src;
    }
    return null;
  }

  var SELF = selfSrc();
  var BASE = SELF ? new URL(SELF, window.location.href).origin : window.location.origin;
  var API = BASE + '/api/v1/public';

  function get(url) {
    return fetch(url, { credentials: 'omit', mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('yuMeet: HTTP ' + r.status);
      return r.json();
    });
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  /** 按浏览者时区渲染(原则 6) */
  function fmtRange(startIso, endIso, locale) {
    var s = new Date(startIso), e = new Date(endIso);
    var d = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    var sameDay = d.format(s) === d.format(e);
    return sameDay ? d.format(s) : d.format(s) + ' – ' + d.format(e);
  }

  function fmtTime(iso, locale, tz) {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  }

  /* ---------------- 样式:两档主题 ---------------- */

  var COMMON = [
    ':host{display:block;',
    'font-family:var(--yu-embed-font,inherit);',
    'color:inherit;box-sizing:border-box}',
    '*,*::before,*::after{box-sizing:inherit}',
    'a{color:var(--yu-embed-accent,#0071e3);text-decoration:none}',
    'a:hover{text-decoration:underline}',
    'a:focus-visible{outline:3px solid var(--yu-embed-accent,#0071e3);outline-offset:2px}',
    '.list{list-style:none;margin:0;padding:0;display:grid;gap:12px}',
    '.card{display:grid;gap:6px;padding:16px 18px;',
    'border:1px solid var(--yu-embed-hairline,rgba(128,128,128,.32));',
    'border-radius:var(--yu-embed-radius,14px);',
    'background:var(--yu-embed-surface,transparent);',
    'transition:border-color .2s ease,transform .2s ease}',
    '.card:hover{border-color:var(--yu-embed-accent,#0071e3);transform:translateY(-1px);text-decoration:none}',
    '.title{font-size:1.05em;font-weight:600;line-height:1.3;text-wrap:balance}',
    '.meta{font-size:.85em;opacity:.72;line-height:1.45}',
    '.badge{justify-self:start;font-size:.72em;font-weight:600;padding:2px 10px;border-radius:980px;',
    'background:color-mix(in srgb,var(--yu-embed-accent,#0071e3) 14%,transparent);',
    'color:var(--yu-embed-accent,#0071e3)}',
    '.btn{display:inline-block;font:inherit;font-size:.95em;font-weight:500;cursor:pointer;',
    'padding:11px 24px;border:0;border-radius:var(--yu-embed-radius-pill,980px);',
    'background:var(--yu-embed-accent,#0071e3);color:#fff;text-decoration:none}',
    '.btn:hover{filter:brightness(1.08);text-decoration:none}',
    '.btn[disabled]{opacity:.5;cursor:not-allowed}',
    '.err{font-size:.85em;opacity:.7}',
    '.skl{height:1em;border-radius:4px;background:currentColor;opacity:.08;animation:p 1.4s ease-in-out infinite}',
    '@keyframes p{50%{opacity:.16}}',
    '@media (prefers-reduced-motion:reduce){.skl{animation:none}.card{transition:none}}',
    '.day{font-size:.8em;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.6;',
    'margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--yu-embed-hairline,rgba(128,128,128,.24))}',
    '.slot{display:flex;gap:12px;padding:7px 0;font-size:.9em;line-height:1.4}',
    '.slot time{flex:0 0 auto;min-width:3.4em;font-variant-numeric:tabular-nums;opacity:.6}',
    '.cd{display:flex;gap:14px;margin-top:4px}',
    '.cd div{text-align:center}',
    '.cd b{display:block;font-size:1.5em;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}',
    '.cd span{font-size:.7em;opacity:.6}',
  ].join('');

  // theme="cupertino" 时带上完整观感;默认 inherit 只继承宿主
  var CUPERTINO = [
    ':host{font-family:system-ui,-apple-system,"SF Pro Text","Segoe UI",',
    '"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif;',
    'font-size:17px;line-height:1.6;color:#1d1d1f}',
    '.card{background:#fff;border-color:#d2d2d7}',
    '@media (prefers-color-scheme:dark){:host{color:#f5f5f7}',
    '.card{background:#1d1d1f;border-color:rgba(255,255,255,.16)}',
    'a,.badge{color:#2997ff}.btn{background:#2997ff}}',
  ].join('');

  /* ---------------- 基类 ---------------- */

  function Base() {
    var self = Reflect.construct(HTMLElement, [], this.constructor);
    self._root = self.attachShadow({ mode: 'open' });
    return self;
  }
  Base.prototype = Object.create(HTMLElement.prototype);
  Base.prototype.constructor = Base;
  Object.setPrototypeOf(Base, HTMLElement);

  Base.prototype.locale = function () {
    return this.getAttribute('locale') || document.documentElement.lang || navigator.language || 'en';
  };

  Base.prototype.mount = function (node) {
    var style = document.createElement('style');
    style.textContent = COMMON + (this.getAttribute('theme') === 'cupertino' ? CUPERTINO : '');
    this._root.replaceChildren(style, node);
  };

  /** 加载中骨架;失败时保留插槽后备内容(无 JS 后备同理) */
  Base.prototype.skeleton = function (rows) {
    var wrap = el('div');
    for (var i = 0; i < (rows || 3); i++) {
      var s = el('div', { class: 'skl', 'aria-hidden': 'true' });
      s.style.marginBottom = '10px';
      s.style.height = i === 0 ? '1.4em' : '1em';
      wrap.appendChild(s);
    }
    wrap.setAttribute('aria-busy', 'true');
    this.mount(wrap);
  };

  Base.prototype.fail = function (msg) {
    // 保留宿主写在元素内的后备内容(如「查看全部活动」链接)
    var fallback = el('slot');
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'err' }, msg));
    wrap.appendChild(fallback);
    this.mount(wrap);
  };

  /* ---------------- <yumeet-event-list> ---------------- */

  function EventList() { return Base.call(this); }
  EventList.prototype = Object.create(Base.prototype);
  EventList.prototype.constructor = EventList;
  Object.setPrototypeOf(EventList, Base);

  EventList.prototype.connectedCallback = function () {
    var self = this;
    var org = this.getAttribute('org');
    var limit = this.getAttribute('limit') || '5';
    if (!org) return this.fail('yuMeet: 缺少 org 属性');
    this.skeleton(3);

    get(API + '/orgs/' + encodeURIComponent(org) + '/events?limit=' + encodeURIComponent(limit))
      .then(function (res) {
        var items = res.data || [];
        if (!items.length) return self.fail('暂无公开活动');
        var ul = el('ul', { class: 'list' });
        items.forEach(function (ev) {
          var li = el('li');
          var a = el('a', { class: 'card', href: ev.urls.public });
          a.appendChild(el('span', { class: 'title' }, ev.title));
          a.appendChild(el('span', { class: 'meta' },
            fmtRange(ev.starts_at, ev.ends_at, self.locale())
            + (ev.venue && ev.venue.name ? ' · ' + ev.venue.name : '')));
          if (ev.status === 'published') a.appendChild(el('span', { class: 'badge' }, '报名开放'));
          else if (ev.status === 'live') a.appendChild(el('span', { class: 'badge' }, '进行中'));
          li.appendChild(a);
          ul.appendChild(li);
        });
        self.mount(ul);
      })
      .catch(function () { self.fail('活动信息暂时无法加载'); });
  };

  /* ---------------- <yumeet-next-event> ---------------- */

  function NextEvent() { return Base.call(this); }
  NextEvent.prototype = Object.create(Base.prototype);
  NextEvent.prototype.constructor = NextEvent;
  Object.setPrototypeOf(NextEvent, Base);

  NextEvent.prototype.connectedCallback = function () {
    var self = this;
    var org = this.getAttribute('org');
    if (!org) return this.fail('yuMeet: 缺少 org 属性');
    this.skeleton(2);

    get(API + '/orgs/' + encodeURIComponent(org) + '/events?limit=1')
      .then(function (res) {
        var ev = (res.data || [])[0];
        if (!ev) return self.fail('暂无即将举行的活动');
        var a = el('a', { class: 'card', href: ev.urls.public });
        a.appendChild(el('span', { class: 'title' }, ev.title));
        a.appendChild(el('span', { class: 'meta' },
          fmtRange(ev.starts_at, ev.ends_at, self.locale())
          + (ev.venue && ev.venue.name ? ' · ' + ev.venue.name : '')));

        var days = Math.ceil((new Date(ev.starts_at) - Date.now()) / 86400000);
        if (days > 0) {
          var cd = el('div', { class: 'cd' });
          var box = el('div');
          box.appendChild(el('b', null, String(days)));
          box.appendChild(el('span', null, '天后开幕'));
          cd.appendChild(box);
          a.appendChild(cd);
        }
        self.mount(a);
      })
      .catch(function () { self.fail('活动信息暂时无法加载'); });
  };

  /* ---------------- <yumeet-schedule> ---------------- */

  function Schedule() { return Base.call(this); }
  Schedule.prototype = Object.create(Base.prototype);
  Schedule.prototype.constructor = Schedule;
  Object.setPrototypeOf(Schedule, Base);

  Schedule.prototype.connectedCallback = function () {
    var self = this;
    var ev = this.getAttribute('event');
    var dayFilter = this.getAttribute('day');
    var limit = parseInt(this.getAttribute('limit') || '0', 10);
    if (!ev) return this.fail('yuMeet: 缺少 event 属性');
    this.skeleton(5);

    get(API + '/events/' + encodeURIComponent(ev) + '/schedule')
      .then(function (res) {
        var sessions = res.sessions || res.data || [];
        if (!sessions.length) return self.fail('日程尚未发布');
        var tz = (res.event && res.event.timezone) || res.timezone || undefined;
        var wrap = el('div');
        var lastDay = null;
        var shown = 0;

        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i];
          var dayKey = new Intl.DateTimeFormat('sv-SE',
            { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
            .format(new Date(s.starts_at));
          if (dayFilter && dayKey !== dayFilter) continue;
          if (limit && shown >= limit) break;

          if (dayKey !== lastDay) {
            wrap.appendChild(el('div', { class: 'day' },
              new Intl.DateTimeFormat(self.locale(),
                { timeZone: tz, month: 'long', day: 'numeric', weekday: 'short' })
                .format(new Date(s.starts_at))));
            lastDay = dayKey;
          }
          var row = el('div', { class: 'slot' });
          var t = el('time', { datetime: s.starts_at }, fmtTime(s.starts_at, self.locale(), tz));
          row.appendChild(t);
          var body = el('div');
          body.appendChild(el('div', null, s.title));
          var metaBits = [];
          if (s.speakers && s.speakers.length) {
            metaBits.push(s.speakers.map(function (x) { return x.name; }).join('、'));
          }
          if (s.room && s.room.name) metaBits.push(s.room.name);
          if (metaBits.length) body.appendChild(el('div', { class: 'meta' }, metaBits.join(' · ')));
          row.appendChild(body);
          wrap.appendChild(row);
          shown++;
        }
        if (!shown) return self.fail('该日无日程');
        if (tz) wrap.appendChild(el('p', { class: 'meta' }, '时间为会场当地时间(' + tz + ')'));
        self.mount(wrap);
      })
      .catch(function () { self.fail('日程暂时无法加载'); });
  };

  /* ---------------- <yumeet-register-button> ---------------- */

  function RegisterButton() { return Base.call(this); }
  RegisterButton.prototype = Object.create(Base.prototype);
  RegisterButton.prototype.constructor = RegisterButton;
  Object.setPrototypeOf(RegisterButton, Base);

  RegisterButton.prototype.connectedCallback = function () {
    var self = this;
    var ev = this.getAttribute('event');
    var label = this.getAttribute('label') || '注册参会';
    if (!ev) return this.fail('yuMeet: 缺少 event 属性');

    get(API + '/events/' + encodeURIComponent(ev))
      .then(function (d) {
        var reg = d.registration || {};
        var href = reg.url || (d.urls && d.urls.register) || (d.urls && d.urls.public);
        if (!href) return self.fail('该活动暂未开放注册');
        var wrap = el('div');
        // 注册与支付始终发生在 yuMeet 侧:新窗口打开,宿主页面不接触任何个人信息
        var a = el('a', {
          class: 'btn', href: href, target: '_blank', rel: 'noopener noreferrer',
        }, label);
        wrap.appendChild(a);
        if (reg.open === false) {
          a.setAttribute('disabled', '');
          wrap.appendChild(el('p', { class: 'meta' }, '注册已截止'));
        }
        self.mount(wrap);
      })
      .catch(function () { self.fail('暂时无法加载注册入口'); });
  };

  /* ---------------- 注册自定义元素 ---------------- */

  var defs = [
    ['yumeet-event-list', EventList],
    ['yumeet-next-event', NextEvent],
    ['yumeet-schedule', Schedule],
    ['yumeet-register-button', RegisterButton],
  ];
  for (var i = 0; i < defs.length; i++) {
    if (!customElements.get(defs[i][0])) customElements.define(defs[i][0], defs[i][1]);
  }
})();
