// scripts/createSuperadmin.ts

import { adminAuth } from '../api/_lib/firebaseAdmin';

function parseArgs(): { email: string; password: string; nombre?: string } {
  const args = process.argv.slice(2);
  const parsed: { email?: string; password?: string; nombre?: string } = {};

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      parsed.email = arg.split('=')[1];
    } else if (arg.startsWith('--password=')) {
      parsed.password = arg.split('=')[1];
    } else if (arg.startsWith('--nombre=')) {
      parsed.nombre = arg.split('=')[1];
    }
  }

  if (!parsed.email || !parsed.password) {
    console.error('Error: --email y --password son requeridos');
    console.error('Uso: tsx scripts/createSuperadmin.ts --email="..." --password="..." [--nombre="..."]');
    process.exit(1);
  }

  return {
    email: parsed.email,
    password: parsed.password,
    nombre: parsed.nombre,
  };
}

async function main() {
  try {
    const { email, password, nombre } = parseArgs();

    console.log('Creando usuario superadmin...');
    console.log(`Email: ${email}`);
    if (nombre) {
      console.log(`Nombre: ${nombre}`);
    }

    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: nombre,
      emailVerified: true,
      disabled: false,
    });

    console.log(`Usuario creado con UID: ${userRecord.uid}`);

    await adminAuth.setCustomUserClaims(userRecord.uid, {
      admin: true,
      superadmin: true,
    });

    console.log('Custom claims aplicados: { admin: true, superadmin: true }');
    console.log(`✅ Superadmin creado exitosamente. UID: ${userRecord.uid}`);
  } catch (error) {
    console.error('Error creando superadmin:', error);
    process.exit(1);
  }
}

main();

