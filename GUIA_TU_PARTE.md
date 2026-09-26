# Guía gratuita: Firebase, GitHub y publicación

Esta versión usa solo Firebase Authentication, Realtime Database y Firebase Hosting en el plan Spark. **No actives Storage ni actualices a Blaze.**

## 1. Lo que ya configuraste

- Proyecto Firebase: `subastamotor-hugo`.
- Aplicación web registrada.
- Authentication con correo electrónico/contraseña habilitada.
- Realtime Database creada en `us-central1` y modo bloqueado.

No agregues Firestore, Storage, Gemini, Analytics ni proveedores de inicio de sesión adicionales.

## 2. Crear el archivo de configuración local

En la carpeta del proyecto, duplica `.env.example` y renómbralo `.env.local`. Copia estos valores desde la configuración de tu aplicación web y Realtime Database:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=tu_api_key_de_la_app_web
NEXT_PUBLIC_FIREBASE_PROJECT_ID=subastamotor-hugo
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://subastamotor-hugo-default-rtdb.firebaseio.com
```

Guarda el archivo y no lo subas a GitHub. Aunque `apiKey` es visible en una app web de Firebase, no compartas archivos `.env.local` ni credenciales de tus cuentas.

## 3. Instalar Firebase CLI y desplegar

En una terminal dentro de la carpeta del proyecto, ejecuta una línea a la vez:

```bash
npm install -g firebase-tools
firebase login
firebase projects:list
firebase use --add
npm install
npm run build
firebase deploy --only database,hosting
```

En `firebase use --add`, selecciona `subastamotor-hugo`. Al finalizar, Firebase mostrará una URL similar a `https://subastamotor-hugo.web.app`. Pruébala y reemplaza el marcador de enlace publicado en `README.md`.

## 4. Crear las tres cuentas de prueba

En **Authentication → Usuarios → Agregar usuario**, crea:

| Nombre | Correo | Contraseña |
| --- | --- | --- |
| Comprador 1 | `comprador1@subastamotor.test` | `Subasta2026!A` |
| Comprador 2 | `comprador2@subastamotor.test` | `Subasta2026!B` |
| Vendedor | `vendedor@subastamotor.test` | `Subasta2026!C` |

Para capturar nombre y teléfono en el perfil, la primera vez registra cada cuenta desde el formulario del sitio. Si una cuenta ya existe desde la consola, puedes eliminarla y crearla desde el sitio usando esos mismos datos.

## 5. Prueba de tiempo real

1. Entra con Vendedor y publica un vehículo que empiece dentro de al menos 10 minutos.
2. Añade cinco fotos. La app las convierte a JPEG comprimido para la cuota gratuita.
3. Abre el sitio en dos ventanas privadas o navegadores diferentes.
4. Inicia sesión con Comprador 1 y Comprador 2.
5. Haz una oferta válida con Comprador 1.
6. Confirma que Comprador 2 ve el nuevo monto sin F5.
7. Desde Comprador 2, ofrece al menos 10 % más. El primer navegador debe mostrar oferta superada y el segundo, que va ganando.
8. Prueba una oferta menor al mínimo y otra cuando el temporizador finalice: ambas deben ser rechazadas por Firebase.

## 6. Subir a GitHub

```bash
git init
git add .
git commit -m "Proyecto SubastaMotor listo para evaluación"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO
git push -u origin main
```

Antes de `git add .`, ejecuta `git status` y confirma que `.env.local` no aparezca.

## Lista final

- [ ] URL publicada y activa dentro de `README.md`.
- [ ] Repositorio GitHub accesible para el catedrático.
- [ ] Tres cuentas activas y documentadas.
- [ ] Vehículo con mínimo cinco fotos.
- [ ] Filtros por marca y daño funcionando.
- [ ] Prueba cruzada de pujas en dos navegadores sin F5.
- [ ] Oferta base, incremento del 10 %, horario y autenticación probados.

## Errores frecuentes

- **`Firebase todavía no está configurado`**: revisa los tres valores de `.env.local` y reinicia `npm run dev`.
- **`permission denied` al publicar u ofertar**: ejecuta `firebase deploy --only database` para aplicar las reglas incluidas en el proyecto.
- **La oferta no cambia en otro navegador**: verifica que ambos usen la URL publicada correcta y hayan iniciado sesión.
- **Foto demasiado grande**: usa una fotografía de menor resolución; cada imagen se limita para conservar la cuota gratuita.
