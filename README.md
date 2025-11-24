# Mutter Games – Admin API (Producción)

API segura y desacoplada utilizada por el panel administrativo de **Mutter Games**, diseñada para manejar operaciones de alto privilegio mediante Firebase Admin SDK, autenticación robusta y validación estricta.

Este backend está aislado del frontend público y expone únicamente endpoints protegidos para administración.

---

## 🚀 Tecnologías principales

- **Node.js + Vercel Serverless Functions**
- **Firebase Admin SDK**
- **Firestore**
- **TypeScript**
- **CORS seguro + tokens verificados**
- **Custom Claims (admin / superadmin)**
- **ImageKit (firma segura para uploads)**

---

## 🔐 Seguridad y arquitectura

Este backend funciona como capa de seguridad sobre Firestore:

1. **Valida el token** enviado por el frontend admin (`Authorization: Bearer <idToken>`).
2. **Verifica roles** (`admin` / `superadmin`) usando `verifyIdToken` y Custom Claims.
3. **Aplica CORS estricto** para producción.
4. **Todos los writes a Firestore** pasan por esta API (el frontend ya no escribe directo).
5. **Endpoints independientes para DEV y PROD**, cada uno con sus propias credenciales.

---

## 📂 Endpoints principales

### 🔸 Productos  
`/api/admin/products`  
CRUD completo de productos con normalización de:
- slug
- variantes
- stockTotal
- priceUSD
- timestamps

### 🔸 Categorías  
`/api/admin/categories`  
Crear, editar y eliminar categorías/subcategorías con validaciones.

### 🔸 Clientes  
`/api/admin/clients`  
Lectura y edición segura del perfil de clientes.

### 🔸 Usuarios admin  
`/api/admin/users`  
Gestión de administradores + asignación de roles usando Firebase Custom Claims.

### 🔸 Órdenes  
`/api/admin/orders`  
Lectura y borrado seguro (la creación se ejecuta desde backend para proteger reglas).

### 🔸 Firma de ImageKit  
`/api/imagekit-signature`  
Genera **token + firma + expiración** para subir imágenes sin exponer claves privadas.

---

## ⚙️ Variables de entorno requeridas

En Vercel → Project Settings → Environment Variables:

### Firebase (producción)
```
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

### ImageKit (producción)
```
IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
IMAGEKIT_URL_ENDPOINT=
```

---

## ▶️ Despliegue

Este proyecto se despliega automáticamente con cada push a `main`.

Producción:  
https://mutter-games-admin-api-prod.vercel.app

---

## 🧪 Tests integrados

El frontend Mutter Games ejecuta:
- Tests unitarios (Vitest)
- Tests de reglas Firestore
- Tests E2E (Playwright)  
Este backend está diseñado para funcionar como origen seguro en todos esos flujos.

---

## 📝 Estado del proyecto

✔ 100% funcional en producción  
✔ API segura  
✔ Usada activamente por el panel administrativo Mutter Games  
✔ Conectada a Firestore con privilegios controlados  

---

## 👤 Autor

**Rodrigo Opalo**  
https://github.com/devrodri-com

https://devrodri.com