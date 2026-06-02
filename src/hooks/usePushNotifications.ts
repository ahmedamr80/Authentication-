import { useState, useEffect, useRef } from 'react';
import { getToken, onMessage, Unsubscribe } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, getMessagingInstance } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

export function usePushNotifications() {
    const { user } = useAuth();
    const [token, setToken] = useState<string | null>(null);
    const [notificationPermissionStatus, setNotificationPermissionStatus] = useState<NotificationPermission | null>(null);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && 'Notification' in window) {
            const permission = Notification.permission;
            setTimeout(() => {
                setNotificationPermissionStatus(permission);
            }, 0);
        }
    }, []);

    const requestPermission = async () => {
        if (!user) return;

        try {
            console.log('Requesting notification permission...');
            const permission = await Notification.requestPermission();
            setNotificationPermissionStatus(permission);

            if (permission === 'granted') {
                console.log('Notification permission granted.');
                
                const messaging = await getMessagingInstance();
                if (!messaging) return;

                // Wait for the service worker to be ready so we pass it explicitly to getToken.
                // This prevents the SDK from trying to implicitly register '/firebase-messaging-sw.js'
                // without our custom URL query parameters.
                const registration = await navigator.serviceWorker.ready;

                // Get registration token. Initially this makes a network call, once retrieved
                // subsequent calls to getToken will return from cache.
                const currentToken = await getToken(messaging, { 
                    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
                    serviceWorkerRegistration: registration
                });
                
                if (currentToken) {
                    setToken(currentToken);
                    console.log('FCM Token:', currentToken);
                    
                    // Save token to Firestore user document
                    const userRef = doc(db, 'users', user.uid);
                    await updateDoc(userRef, {
                        fcmTokens: arrayUnion(currentToken)
                    });
                    
                } else {
                    console.log('No registration token available. Request permission to generate one.');
                }
            } else {
                console.log('Unable to get permission to notify.');
            }
        } catch (error) {
            console.error('An error occurred while retrieving token. ', error);
        }
    };

    // Listen for foreground messages
    useEffect(() => {
        const setupMessaging = async () => {
            const messaging = await getMessagingInstance();
            if (!messaging) return;

            unsubscribeRef.current = onMessage(messaging, (payload) => {
                console.log('[Foreground] Message received. ', payload);
                // You can customize foreground notification handling here
                // e.g., show a toast or a custom UI element
                
                // For now, let's trigger a native notification if we have permission
                // The browser usually doesn't show standard push notifications when app is in foreground
                if (Notification.permission === 'granted') {
                    const notificationTitle = payload.notification?.title || 'New Notification';
                    const notificationOptions = {
                        body: payload.notification?.body,
                        icon: '/logo.png', // Fallback icon
                    };
                    new Notification(notificationTitle, notificationOptions);
                }
            });
        };

        setupMessaging();

        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
            }
        };
    }, []);

    return { token, notificationPermissionStatus, requestPermission };
}
