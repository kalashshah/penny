'use client';

import { useEffect } from 'react';

/**
 * The landing page's motion, on the static markup in landing.tsx: hero stagger, KPI digits, the streaming
 * caption, the demo tabs, the FAQ accordion, card tilt and scroll reveals. Plain DOM work on markup React
 * renders once and never updates; everything it starts is torn down on unmount.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.ui-landing');
    if (!root) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ac = new AbortController();
    const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void) =>
      el.addEventListener(type, fn as EventListener, { signal: ac.signal });
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => void timers.push(window.setTimeout(fn, ms));
    const reflow = (el: HTMLElement) => void el.offsetHeight;
    const all = <T extends Element = HTMLElement>(sel: string, from: ParentNode = root) => [...from.querySelectorAll<T>(sel)] as T[];

    /* Number pop-in: split a KPI into digits, the last two ride in late. */
    const popDigits = (el: HTMLElement) => {
      if (el.dataset.popped) return;
      el.dataset.popped = '1';
      const chars = [...(el.textContent ?? '').trim()];
      el.textContent = '';
      el.classList.add('t-digit-group');
      chars.forEach((ch, i) => {
        const sp = document.createElement('span');
        sp.className = 't-digit';
        sp.textContent = ch;
        const fromEnd = chars.length - 1 - i;
        if (fromEnd === 1) sp.dataset.stagger = '1';
        if (fromEnd === 0) sp.dataset.stagger = '2';
        el.appendChild(sp);
      });
      reflow(el);
      el.classList.add('is-animating');
    };
    const popAll = (from: ParentNode, delay = 0) => later(() => all('.kpi .n', from).forEach(popDigits), delay);

    /* Success check on an approval card, after "the yes". */
    const approve = (from: ParentNode, delay = 1600) =>
      all('.approve', from).forEach((card) => {
        if (card.classList.contains('is-done')) return;
        later(() => {
          card.classList.add('is-done');
          card.querySelector('.t-success-check')?.setAttribute('data-state', 'in');
        }, delay);
      });

    /* Toasts inside a revealed block rise in a beat later. */
    const toasts = (from: ParentNode) => all('.t-toast', from).forEach((t, i) => later(() => t.classList.add('is-open'), 250 + i * 120));

    /* Hero: texts reveal, then the window, then the numbers, then the caption streams. */
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('heroCopy')?.classList.add('is-shown')));
    const heroWin = root.querySelector<HTMLElement>('.hero .win');
    if (heroWin) popAll(heroWin, 700);
    const cap = root.querySelector<HTMLElement>('.t-stream');
    let streamTimer: number | undefined;
    if (cap) {
      const words = (cap.textContent ?? '').trim().split(/\s+/);
      cap.textContent = '';
      const spans = words.map((w, i) => {
        const sp = document.createElement('span');
        sp.className = 't-stream-w' + (reduce ? ' is-in' : '');
        sp.textContent = w;
        cap.appendChild(sp);
        if (i < words.length - 1) cap.appendChild(document.createTextNode(' '));
        return sp;
      });
      const stream = () => {
        if (reduce) return;
        spans.forEach((sp) => {
          sp.style.transition = 'none';
          sp.classList.remove('is-in');
        });
        reflow(cap);
        spans.forEach((sp) => (sp.style.transition = ''));
        const next = (n: number) => {
          if (n >= spans.length) return;
          spans[n].classList.add('is-in');
          later(() => next(n + 1), 55);
        };
        next(0);
      };
      later(stream, 1100);
      streamTimer = window.setInterval(stream, 9000);
    }

    /* Accordion */
    all('.t-acc-head').forEach((h) =>
      on(h, 'click', () => {
        const acc = h.parentElement!;
        const open = acc.getAttribute('data-open') === 'true';
        acc.setAttribute('data-open', String(!open));
        h.setAttribute('aria-expanded', String(!open));
      }),
    );

    /* Card tilt with glare (pointer only). */
    if (!reduce)
      all('.t-tilt').forEach((w) => {
        const card = w.querySelector<HTMLElement>('.t-tilt-card')!;
        const max = 5;
        on(w, 'pointerenter', (e) => e.pointerType !== 'touch' && w.classList.add('is-hover'));
        on(w, 'pointermove', (e) => {
          if (e.pointerType === 'touch') return;
          const r = w.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          card.classList.add('is-tilting');
          card.style.setProperty('--tilt-ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
          card.style.setProperty('--tilt-rx', `${(-(y - 0.5) * 2 * max).toFixed(2)}deg`);
          card.style.setProperty('--tilt-gx', `${(x * 100).toFixed(1)}%`);
          card.style.setProperty('--tilt-gy', `${(y * 100).toFixed(1)}%`);
        });
        on(w, 'pointerleave', () => {
          w.classList.remove('is-hover');
          card.classList.remove('is-tilting');
          card.style.setProperty('--tilt-rx', '0deg');
          card.style.setProperty('--tilt-ry', '0deg');
        });
      });

    /* Scroll reveal, then the numbers, toasts and approval inside the block. */
    const arrive = (el: HTMLElement) => {
      el.classList.add('in');
      popAll(el, 250);
      toasts(el);
      approve(el, 1800);
    };
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          arrive(e.target as HTMLElement);
          io.unobserve(e.target);
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    all('.reveal').forEach((el) => io.observe(el));

    return () => {
      ac.abort();
      io.disconnect();
      cancelAnimationFrame(raf);
      clearInterval(streamTimer);
      timers.forEach(clearTimeout);
    };
  }, []);
  return null;
}
