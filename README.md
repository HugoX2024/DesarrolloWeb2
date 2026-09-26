# SubastaMotor

Plataforma web de subastas de vehículos tipo Copart, creada para el segundo parcial. Permite explorar un inventario público, registrarse, publicar vehículos con galería y participar en pujas en tiempo real.

> **Sitio publicado:** [https://subastamotor-hugo.web.app](https://subastamotor-hugo.web.app)

## Funcionalidades

- Catálogo público con buscador y filtros por marca y daño.
- Ficha técnica completa, estados Verde/Amarillo/Rojo y carrusel de cinco fotos o más.
- Registro e inicio de sesión: nombre, apellido, correo, teléfono y contraseña.
- Publicación y edición del vehículo propio antes de que inicie su subasta.
- Precio base, fechas de inicio/cierre y contador visible en tiempo real.
- Pujas anónimas con aumento mínimo del 10 %.
- Avisos de “vas ganando” y “tu oferta ha sido superada”.
- Reglas de Firebase que bloquean ofertas sin sesión, fuera de horario, bajo el precio base o con incremento insuficiente.

## Arquitectura sin costo

```text
Next.js estático ── Firebase Authentication
       │            └─ Realtime Database + Security Rules
       │                 ├─ inventario público
       │                 ├─ ofertas en tiempo real
       │                 └─ perfiles y ofertas privadas por usuario
       └─ fotos JPEG comprimidas dentro de Realtime Database
```

La aplicación no requiere Firebase Storage ni Cloud Functions. Las reglas de Realtime Database se evalúan en los servidores de Firebase y validan cada escritura antes de aceptarla. Las fotos se reducen automáticamente para mantener el proyecto dentro de la cuota gratuita; es una solución adecuada para la demostración académica, no para un catálogo comercial grande.

## Ejecución local

Requisitos: Node.js 22 o superior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`. Sin `.env.local`, la aplicación funciona con datos de demostración para revisar el diseño y los flujos.

Para activar Firebase, copia `.env.example` a `.env.local` y completa sus tres valores. Consulta [GUIA_TU_PARTE.md](GUIA_TU_PARTE.md).

## Despliegue gratuito

```bash
npm run build
firebase login
firebase use --add
firebase deploy --only database,hosting
```

`firebase.json` publica la carpeta estática `out/` y despliega las reglas de la base de datos.

## Pruebas de entrega

1. Crea las tres cuentas de prueba descritas abajo.
2. Publica un vehículo con al menos cinco fotografías desde la cuenta Vendedor.
3. Abre la URL en dos o tres navegadores o ventanas privadas.
4. Inicia sesión con Comprador 1 y Comprador 2 y realiza ofertas alternadas.
5. Comprueba que monto, contador y estado cambian sin F5.
6. Intenta ofertar bajo el mínimo, fuera de horario y sin sesión: Firebase debe rechazarlo.

## Credenciales de prueba

| Usuario | Correo | Contraseña |
| --- | --- | --- |
| Comprador 1 | `comprador1@subastamotor.test` | `Subasta2026!A` |
| Comprador 2 | `comprador2@subastamotor.test` | `Subasta2026!B` |
| Vendedor | `vendedor@subastamotor.test` | `Subasta2026!C` |

No reutilices estas contraseñas en una cuenta personal. Mantén esta tabla en el repositorio para que el catedrático pueda realizar las pruebas cruzadas.
