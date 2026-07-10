rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    match /clientes/{document} {
      allow read, write: if signedIn();
    }
    match /pedidos/{document} {
      allow read, write: if signedIn();
    }
    match /cajaTurnos/{document} {
      allow read, write: if signedIn();
    }
    match /productos/{document} {
      allow read, write: if signedIn();
    }
    match /cotizaciones/{document} {
      allow read, write: if signedIn();
    }
    match /usuarios/{document} {
      allow read, write: if signedIn();
    }
    match /config/{document} {
      allow read, write: if signedIn();
    }
  }
}
