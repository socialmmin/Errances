'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

// Converts the VAPID public key (base64url) into the Uint8Array format the
// Push API's applicationServerKey expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Registers the service worker and subscribes to Web Push once the user is
// authenticated, so new-lead alerts arrive even with the CRM tab/browser
// closed. Silently no-ops on unsupported browsers or if permission is
// denied -- this is a background enhancement, never something to block on.
export function usePushNotifications(enabled: boolean) {
  const [status, setStatus] = useState<'unsupported'|'prompt'|'denied'|'enabled'>('prompt');
  const setup = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setStatus('unsupported'); return 'unsupported' as const; }
    if (Notification.permission === 'denied') { setStatus('denied'); return 'denied' as const; }
    // Ask for permission FIRST, before any slow async work (service worker
    // registration). Chrome only shows the native one-click popup while the
    // click's "user activation" is still fresh -- if something slower runs
    // first, Chrome can silently skip the popup instead of showing it, and
    // repeated silent misses are what get a site auto-blocked.
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { const next=permission === 'denied' ? 'denied' : 'prompt';setStatus(next);return next; }
    }
    const registration = await navigator.serviceWorker.register('/sw.js');
    const existing = await registration.pushManager.getSubscription();
    if (existing) { await api.post('/push/subscribe', existing.toJSON()); setStatus('enabled'); return 'enabled' as const; }
    const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
    if (!publicKey) return 'prompt' as const;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
    await api.post('/push/subscribe', subscription.toJSON());
    setStatus('enabled');
    return 'enabled' as const;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    let cancelled = false;

    async function autoSetup() {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');

        if (Notification.permission !== 'granted') { setStatus(Notification.permission === 'denied' ? 'denied' : 'prompt'); return; }
        if (cancelled) return;

        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          await api.post('/push/subscribe', existing.toJSON()).catch(() => undefined);
          setStatus('enabled');
          return;
        }

        const { publicKey } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
        if (!publicKey) return;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
        await api.post('/push/subscribe', subscription.toJSON());
        setStatus('enabled');
      } catch {
        // Push is a nice-to-have; never surface an error for this.
      }
    }

    autoSetup();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  useEffect(()=>{if(typeof navigator==='undefined'||!navigator.permissions?.query)return;let permission:PermissionStatus|undefined;navigator.permissions.query({name:'notifications' as PermissionName}).then(value=>{permission=value;value.onchange=()=>setStatus(value.state==='granted'?'enabled':value.state==='denied'?'denied':'prompt');}).catch(()=>{});return()=>{if(permission)permission.onchange=null;};},[]);
  return { status, enable: setup };
}
