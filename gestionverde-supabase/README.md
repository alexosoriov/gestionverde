# GestiónVerde · prototipo Supabase

Cliente web independiente para validar la migración de Firebase a Supabase sin reemplazar todavía la aplicación estable.

## Incluye

- Supabase Auth con correo y contraseña.
- Acceso con Google OAuth.
- Registro de vecinos con estado `pendiente`.
- Perfiles con roles: administrador, jefatura, supervisor, chofer, recolector y vecino.
- Pantallas para cuentas aprobadas, pendientes y revocadas.
- Lectura protegida de rutas, solicitudes y noticias mediante RLS.
- Diseño adaptable para computador, Android e iPhone.

## 1. Crear el proyecto en Supabase

Crea un proyecto vacío desde Supabase y abre **SQL Editor**. Ejecuta el archivo:

```text
../supabase/migrations/202607210001_gestionverde_base.sql
```

Ese script crea las tablas, índices, trigger de perfiles, roles, políticas RLS, datos base del M-73 y el bucket privado `evidencias`.

## 2. Configurar autenticación

En Supabase → Authentication:

1. Mantén habilitado Email/Password.
2. Define la URL del sitio y las Redirect URLs.
3. Para Google, crea las credenciales OAuth y habilita el proveedor Google.
4. No desactives la confirmación de correo para las cuentas vecinales reales.

## 3. Variables locales

```bash
cp .env.example .env.local
```

Completa:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

La publishable key puede estar en el navegador porque las tablas están protegidas con RLS. La `service_role` nunca debe guardarse en archivos públicos ni comenzar con `VITE_`.

## 4. Ejecutar

```bash
npm install
npm run dev
```

## 5. Aprobar la primera jefatura

Crea la cuenta desde Authentication y luego ejecuta en SQL Editor, reemplazando correo y UID:

```sql
update public.profiles
set rol = 'administrador', estado = 'aprobado', activo = true
where id = 'UID-DE-AUTH-USERS';
```

Las cuentas creadas desde la web nacen intencionalmente como `vecino` y `pendiente`. No se confía en `user_metadata` para entregar roles administrativos.

## 6. Próxima migración

Este prototipo no elimina Firebase automáticamente. Antes del cambio definitivo hay que migrar:

1. usuarios y perfiles;
2. viviendas y sectores;
3. rutas y paradas;
4. solicitudes de retiro;
5. incidencias y evidencias de Storage;
6. historial y auditoría.

Después se reemplazan los adaptadores Firebase de la versión v48 por consultas Supabase y se prueba el login completo con cada rol.
