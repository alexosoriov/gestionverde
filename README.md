# GestiónVerde

Plataforma para apoyar el Programa de Separación de Residuos y Recolección Selectiva de la Municipalidad de Puerto Montt.

> **Privacidad:** este repositorio actualmente es público. No se deben subir nombres, teléfonos, domicilios, coordenadas, claves, archivos `.env` ni respaldos municipales. Antes de utilizar datos reales, cambia el repositorio a privado y revisa su historial.

## Nueva base con Supabase

La carpeta [`gestionverde-supabase/`](gestionverde-supabase/) contiene un cliente web independiente para validar la migración desde Firebase sin romper la aplicación anterior.

Incluye:

- autenticación por correo y contraseña;
- inicio de sesión con Google;
- registro vecinal pendiente de aprobación;
- perfiles con roles municipales;
- estados de cuenta pendiente, aprobado y revocado;
- diseño adaptable para computador, Android e iPhone;
- consultas protegidas mediante PostgreSQL Row Level Security;
- Storage privado para evidencia fotográfica.

El esquema SQL está en:

```text
supabase/migrations/202607210001_gestionverde_base.sql
supabase/migrations/202607210002_harden_auth_trigger.sql
```

## Roles

- `administrador`
- `jefatura`
- `supervisor`
- `chofer`
- `recolector`
- `vecino`

Las cuentas creadas desde la aplicación nacen como `vecino` y `pendiente`. Los roles municipales se asignan únicamente desde un proceso administrativo seguro.

## Modelo inicial

- Perfiles y autorización.
- Sectores y agenda semanal.
- Vehículo M-73.
- Rutas y paradas.
- Jornadas y registros de recolección.
- Solicitudes de retiro vecinal.
- Incidencias y evidencias.
- Noticias públicas.
- Auditoría de acciones.

## Ejecutar el prototipo Supabase

```bash
cd gestionverde-supabase
cp .env.example .env.local
npm install
npm run dev
```

Completa `.env.local` con la URL y publishable key del proyecto Supabase.

## Seguridad

- Todas las tablas sensibles tienen RLS habilitado.
- La publishable key puede usarse en el navegador siempre que las políticas estén correctamente configuradas.
- La `service_role` nunca debe incluirse en código web, variables `VITE_*`, commits o archivos públicos.
- Los perfiles administrativos no se obtienen desde `user_metadata` controlable por el usuario.
- El bucket `evidencias` es privado.

## Migración recomendada desde Firebase

La migración debe hacerse en etapas:

1. Crear y probar Supabase sin desconectar Firebase.
2. Migrar usuarios y perfiles.
3. Migrar viviendas, sectores, rutas y paradas.
4. Migrar solicitudes, incidencias y evidencia de Storage.
5. Reemplazar los adaptadores Firebase de GestiónVerde v48.
6. Probar cada rol, el modo offline, GPS, Android e iPhone.
7. Cambiar producción solamente después de validar los datos.

## Estado del código anterior

La raíz del repositorio aún conserva componentes históricos de Ruta Verde. No deben eliminarse hasta confirmar que el nuevo cliente Supabase cubre autenticación, recorrido, GPS, sincronización offline, panel de Jefatura e informes.
