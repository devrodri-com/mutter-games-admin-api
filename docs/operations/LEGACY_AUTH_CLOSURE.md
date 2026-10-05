# Frontera Firebase: alcance y pendiente operativo

Este Admin admite ID tokens verificados por Firebase con revocación, proveedor
password y roles booleanos admin/superadmin. Conserva CORS y cierre de escritores,
incluida firma ImageKit GET. El endpoint de pedidos retirado sigue en 409.

La política compartida está en `api/_lib/session-authority.ts`; Tienda verifica
igualdad de bytes contra este checkout pareado. Los tests usan Auth/Firestore
demo, nunca credenciales productivas. Cubren custom inicial/renovado, acceso
ordinario, cuentas inválidas/revocadas/deshabilitadas y todos los destinos.

**No se acredita cierre total:** las caracterizaciones reproducen custom →
contraseña vinculada/cambiada → login/renovación con el mismo UID y roles. El
rechazo del proveedor actual no identifica ese origen histórico. No hay prueba
de intrusión ni se autoriza revocar usuarios o claves por este documento.

El procedimiento conjunto canónico está en el target pareado de Tienda:
`docs/operations/LEGACY_AUTH_CLOSURE.md`, ligado por SHA en el informe de entrega.
Exige cierre de emisión, tratamiento de credenciales/sesiones derivadas y
cobertura explícita de Rules antes de completar las familias de credenciales.
No altera el gate ni permite declarar `unresolved:0` por un test verde.
