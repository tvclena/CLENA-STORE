importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC_xFOKDqXRe1r-sjj-Juo6-nDfYceICTI",
  authDomain: "agenda-facil-77785.firebaseapp.com",
  projectId: "agenda-facil-77785",
  storageBucket: "agenda-facil-77785.appspot.com",
  messagingSenderId: "1029015721724",
  appId: "1:1029015721724:web:980a9f6e0cebd702976979"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: "/icon-192.png"
    }
  );
});
