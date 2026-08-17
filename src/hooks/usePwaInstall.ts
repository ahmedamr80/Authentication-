import { useState, useEffect } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkStandalone = () => {
      return (
        window.matchMedia('(display-mode: standalone)').matches || 
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    };

    const checkIOS = () => {
      const userAgent = window.navigator.userAgent || '';
      return (
        /iPad|iPhone|iPod/.test(userAgent) ||
        (userAgent.includes('Mac') && 'ontouchend' in document)
      );
    };

    const initTimer = setTimeout(() => {
      setIsStandalone(checkStandalone());
      setIsIOS(checkIOS());
    }, 0);

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the browser's default install prompt
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
    };

    try {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    } catch {
      // Fallback for older browsers/Safari
      mediaQuery.addListener(handleDisplayModeChange);
    }

    return () => {
      clearTimeout(initTimer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      try {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      } catch {
        mediaQuery.removeListener(handleDisplayModeChange);
      }
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) {
      console.warn('beforeinstallprompt event not yet fired or already used.');
      return null;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setIsInstallable(false);
      return outcome;
    } catch (error) {
      console.error('Error triggering PWA install prompt:', error);
      return null;
    }
  };

  return {
    isInstallable,
    isIOS,
    isStandalone,
    triggerInstall,
  };
}
